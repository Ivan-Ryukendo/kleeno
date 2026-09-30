import type { ChainReader, Clock, PaymentRail, PaymentsRepo } from "../ports";
import { runGate } from "./gate";
import { matchSettlement, type SettlementExpectation } from "./settlement";

export interface AgentDeps {
  repo: PaymentsRepo;
  chain: ChainReader;
  rail: PaymentRail;
  clock: Clock;
  expect: Pick<SettlementExpectation, "chainId" | "guardAddress" | "usdcAddress">;
  pollMs?: number;
  maxPolls?: number;
}

export type PayOutcome =
  | { status: "SETTLED"; txHash: string }
  | { status: "BLOCKED"; failures: string[] }
  | { status: "NOT_CLAIMED" }
  | { status: "PENDING" | "UNKNOWN" | "FAILED" }
  | { status: "MISMATCH"; reasons: string[] };

/**
 * The payment agent: acts on an obligation ID only (rule 21). The single caller of rail.submit.
 * Never retries a submission: unknown stays unknown until proven otherwise (rule 26).
 */
export async function payObligation(obligationId: string, d: AgentDeps): Promise<PayOutcome> {
  const gate = await runGate(obligationId, d.repo, d.chain);
  if (!gate.ok) {
    await d.repo.markException(obligationId, "GATE_FAILED", gate.failures, "AUTHORIZED");
    return { status: "BLOCKED", failures: gate.failures };
  }
  const { pass } = gate;

  if (!(await d.repo.claim(obligationId))) return { status: "NOT_CLAIMED" };
  const { attemptId } = await d.repo.saveAttempt({
    obligationId,
    companyId: pass.companyId,
    idempotencyKey: pass.idempotencyKey,
  });

  let circleTxId: string;
  try {
    ({ circleTxId } = await d.rail.submit(pass, attemptId));
  } catch {
    await d.repo.setAttemptState(attemptId, "UNKNOWN");
    return { status: "UNKNOWN" };
  }
  await d.repo.attachCircleTx(attemptId, circleTxId);
  await d.repo.setAttemptState(attemptId, "SUBMITTED");

  for (let i = 0; i < (d.maxPolls ?? 30); i++) {
    let status;
    try {
      status = await d.rail.getStatus(circleTxId);
    } catch {
      return { status: "UNKNOWN" };
    }
    if (status.state === "FAILED") {
      // Circle says failed; only a proven on-chain "not paid" allows anything further (recovery, P4).
      if (await d.chain.isPaid(pass.onchainKey)) return { status: "UNKNOWN" };
      await d.repo.setAttemptState(attemptId, "FAILED");
      await d.repo.markException(obligationId, "CIRCLE_FAILED", [], "PAYING");
      return { status: "FAILED" };
    }
    if (status.state === "CONFIRMED" && status.txHash) {
      // Circle COMPLETE but no readable Arc receipt yet (RPC lag or error): not a mismatch, keep polling.
      // If the budget runs out the obligation stays PAYING for recovery (P4); the money may already have moved.
      let receipt;
      try {
        receipt = await d.chain.receipt(status.txHash);
      } catch {
        receipt = null;
      }
      if (!receipt) {
        await d.clock.sleep(d.pollMs ?? 2000);
        continue;
      }
      const reasons = matchSettlement(receipt, {
        ...d.expect,
        onchainKey: pass.onchainKey,
        recipient: pass.recipient,
        amount: pass.amount,
      });
      if (reasons.length) {
        await d.repo.markException(obligationId, "SETTLEMENT_MISMATCH", reasons, "PAYING");
        return { status: "MISMATCH", reasons };
      }
      await d.repo.setAttemptState(attemptId, "CONFIRMED");
      await d.repo.markSettled(obligationId, status.txHash);
      return { status: "SETTLED", txHash: status.txHash };
    }
    await d.clock.sleep(d.pollMs ?? 2000);
  }
  return { status: "PENDING" };
}
