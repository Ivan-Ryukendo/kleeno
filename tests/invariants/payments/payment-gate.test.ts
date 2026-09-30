// PROTECTED. S08 (gate matrix, P1 subset), S05 (gate part), S38 (SIMULATION never pays).
import { describe, expect, it } from "vitest";
import { payObligation } from "@/core/payments/agent";
import type { ObligationContext } from "@/core/ports";
import { baseContext, clock, expectChain, FakeChain, FakeRail, FakeRepo } from "./harness";

type Mut = (c: ObligationContext, chain: FakeChain) => void;

// One failing check per case -> DO NOT PAY, PAYMENT_EXCEPTION, submit never called.
const cases: [string, string, Mut][] = [
  ["OBLIGATION_NOT_AUTHORIZED", "obligation not AUTHORIZED", (c) => (c.obligation.status = "CREATED")],
  ["COMPANY_MISMATCH", "run from another company", (c) => (c.run.companyId = "co-2")],
  ["COMPANY_MISMATCH", "batch from another company", (c) => (c.batch!.companyId = "co-2")],
  ["RUN_MISMATCH", "obligation points to another run", (c) => (c.run.id = "run-9")],
  ["NOT_IN_BATCH", "batch not payable", (c) => (c.batch!.status = "PROPOSED")],
  ["PLAN_HASH_MISMATCH", "plan_hash does not recompute", (c) => (c.batch!.planHash = "deadbeef")],
  ["SAME_USER_APPROVAL", "authorizer = payroll approver", (c) => (c.batch!.authorizerId = c.run.payrollApproverId)],
  ["RUN_NOT_LIVE", "SIMULATION run (S38)", (c) => (c.run.mode = "SIMULATION")],
  ["RUN_NOT_APPROVED", "run not approved", (c) => (c.run.status = "CALCULATION_VALIDATED")],
  ["LIVE_PAYMENTS_OFF", "kill switch off (S05)", (c) => (c.company.livePaymentsEnabled = false)],
  ["CALCULATION_HASH_MISMATCH", "calculation changed after approval", (c) => (c.calculationHash = "hash-b")],
  ["AMOUNT_MISMATCH", "obligation != calculation line", (c) => (c.lineAmount = 99_000_000n)],
  ["NOT_USDC", "wrong currency", (c) => (c.obligation.currency = "EURC")],
  ["NOT_ARC_TESTNET", "wrong network", (c) => (c.network = "ETH-SEPOLIA")],
  ["RECIPIENT_MISMATCH", "recipient != approved snapshot", (c) => (c.approvedRecipient = "0x00000000000000000000000000000000000000ff")],
  ["IDEMPOTENCY_KEY_USED", "attempt already exists", (c) => (c.attemptExistsForKey = true)],
  ["OVER_CEILING", "over per-payment ceiling", (c) => (c.company.perPaymentCeiling = 1n)],
  ["NOT_COMMITTED_ON_GUARD", "not committed on the guard", (_c, ch) => (ch.entry.committed = false)],
  ["NOT_COMMITTED_ON_GUARD", "guard run not open", (_c, ch) => (ch.entry.runOpen = false)],
  ["ALREADY_PAID_ON_GUARD", "already paid on the guard", (_c, ch) => (ch.entry.paid = true)],
];

describe("S08 gate matrix", () => {
  it.each(cases)("%s: %s", async (code, _label, mutate) => {
    const ctx = baseContext();
    const chain = new FakeChain();
    mutate(ctx, chain);
    const repo = new FakeRepo(ctx);
    const rail = new FakeRail(chain);
    const out = await payObligation("ob-1", { repo, chain, rail, clock, expect: expectChain });
    expect(out.status).toBe("BLOCKED");
    expect(out.status === "BLOCKED" && out.failures).toContain(code);
    expect(rail.submits).toBe(0);
    if (code !== "OBLIGATION_NOT_AUTHORIZED") expect(repo.status).toBe("PAYMENT_EXCEPTION");
  });

  it("a clean obligation passes and settles", async () => {
    const chain = new FakeChain();
    const repo = new FakeRepo(baseContext());
    const rail = new FakeRail(chain);
    const out = await payObligation("ob-1", { repo, chain, rail, clock, expect: expectChain });
    expect(out).toEqual({ status: "SETTLED", txHash: "0xtx1" });
    expect(repo.status).toBe("SETTLED");
  });

  it("the rail rejects a hand-built pass (S07)", async () => {
    const rail = new FakeRail(new FakeChain());
    const forged = { obligationId: "ob-1", amount: 1n, recipient: "0x1", onchainKey: "k", idempotencyKey: "i", companyId: "c" };
    await expect(rail.submit(forged as never)).rejects.toThrow("not a gate pass");
  });
});
