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

/** What the agent needs to follow one payment to its end. Amount and recipient come from the obligation, never from a caller. */
interface Tracked {
  obligationId: string;
  attemptId: string | null;
  onchainKey: string;
  recipient: string;
  amount: bigint;
}

/** Independent of Circle: match the Arc receipt, then settle or raise a mismatch. Null = the receipt is not readable yet (lag or RPC error), so keep waiting. */
async function settle(d: AgentDeps, t: Tracked, txHash: string): Promise<PayOutcome | null> {
  let receipt;
  try {
    receipt = await d.chain.receipt(txHash);
  } catch {
    receipt = null;
  }
  if (!receipt) return null;
  const reasons = matchSettlement(receipt, { ...d.expect, onchainKey: t.onchainKey, recipient: t.recipient, amount: t.amount });
  if (reasons.length) {
    await d.repo.markException(t.obligationId, "SETTLEMENT_MISMATCH", reasons, "PAYING");
    return { status: "MISMATCH", reasons };
  }
  if (t.attemptId) await d.repo.setAttemptState(t.attemptId, "CONFIRMED");
  await d.repo.markSettled(t.obligationId, txHash);
  return { status: "SETTLED", txHash };
}

/** Follows a submitted Circle transaction until it settles, fails or the poll budget runs out (then it stays PAYING for recovery). */
async function track(d: AgentDeps, t: Tracked, circleTxId: string): Promise<PayOutcome> {
  for (let i = 0; i < (d.maxPolls ?? 30); i++) {
    let status;
    try {
      status = await d.rail.getStatus(circleTxId);
    } catch {
      return { status: "UNKNOWN" };
    }
    if (status.state === "FAILED") {
      // Circle says failed; only a proven on-chain "not paid" allows anything further.
      if (await d.chain.isPaid(t.onchainKey)) return { status: "UNKNOWN" };
      if (t.attemptId) await d.repo.setAttemptState(t.attemptId, "FAILED");
      await d.repo.markException(t.obligationId, "CIRCLE_FAILED", [], "PAYING");
      return { status: "FAILED" };
    }
    if (status.state === "CONFIRMED" && status.txHash) {
      // Circle COMPLETE but no readable Arc receipt yet: not a mismatch, keep polling. If the budget runs out the
      // obligation stays PAYING for recovery; the money may already have moved.
      const out = await settle(d, t, status.txHash);
      if (out) return out;
    }
    await d.clock.sleep(d.pollMs ?? 2000);
  }
  return { status: "PENDING" };
}

/**
 * The payment agent: acts on an obligation ID only (rule 21). One of the two callers of rail.submit (the other is resumeObligation).
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
  return track(d, { obligationId, attemptId, onchainKey: pass.onchainKey, recipient: pass.recipient, amount: pass.amount }, circleTxId);
}

/**
 * Recovery for an obligation stuck in PAYING (ARCHITECTURE 14.6, S29). Arc decides, not Circle:
 * - paid on Arc: find the payment transaction and settle it from the receipt; nothing is sent again.
 * - not paid: the gate runs again (kill switch included). With a Circle transaction on record, keep following it. Without one
 *   (crash before the call or before its answer) submit again under the SAME idempotency key, so the payment exists at most once.
 * A Circle failure with nothing paid on Arc becomes a PAYMENT_EXCEPTION, never an automatic second attempt.
 */
export async function resumeObligation(obligationId: string, d: AgentDeps): Promise<PayOutcome> {
  const ctx = await d.repo.loadContext(obligationId);
  if (!ctx || ctx.obligation.status !== "PAYING") return { status: "NOT_CLAIMED" };
  const o = ctx.obligation;
  const attempt = await d.repo.loadAttempt(obligationId);
  const t: Tracked = { obligationId, attemptId: attempt?.id ?? null, onchainKey: o.onchainKey, recipient: o.recipient, amount: o.amount };

  if (await d.chain.isPaid(o.onchainKey)) {
    let txHash: string | null = null;
    if (attempt?.circleTxId) {
      try {
        const s = await d.rail.getStatus(attempt.circleTxId);
        if (s.state === "CONFIRMED") txHash = s.txHash ?? null;
      } catch {
        /* fall back to the chain log */
      }
    }
    txHash ??= await d.chain.paymentTx(o.onchainKey);
    if (!txHash) return { status: "UNKNOWN" }; // paid but not traceable yet: stays PAYING, a human can look
    return (await settle(d, t, txHash)) ?? { status: "PENDING" };
  }

  const gate = await runGate(obligationId, d.repo, d.chain, { resume: true });
  if (!gate.ok) {
    // The kill switch pauses payment; it says nothing against this obligation, so it stays PAYING for when payments resume.
    if (!gate.failures.every((f) => f === "LIVE_PAYMENTS_OFF")) await d.repo.markException(obligationId, "GATE_FAILED", gate.failures, "PAYING");
    return { status: "BLOCKED", failures: gate.failures };
  }
  const { pass } = gate;
  const attemptId = attempt?.id ?? (await d.repo.saveAttempt({ obligationId, companyId: pass.companyId, idempotencyKey: pass.idempotencyKey })).attemptId;
  let circleTxId = attempt?.circleTxId ?? null;
  if (!circleTxId) {
    try {
      ({ circleTxId } = await d.rail.submit(pass, attemptId));
    } catch {
      await d.repo.setAttemptState(attemptId, "UNKNOWN");
      return { status: "UNKNOWN" };
    }
    await d.repo.attachCircleTx(attemptId, circleTxId);
    await d.repo.setAttemptState(attemptId, "SUBMITTED");
  }
  return track(d, { ...t, attemptId }, circleTxId);
}
