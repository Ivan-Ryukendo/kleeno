// PROTECTED. S09: each condition that must send a batch to a human has its own negative case; a clean batch passes.
import { describe, expect, it } from "vitest";
import { checkStanding, type StandingInput } from "@/core/payments/batches/standing";

const A = "0x" + "a".repeat(40);
const NOW = new Date("2026-10-10T12:00:00Z");

const clean = (): StandingInput => ({
  standing: { id: "sa-1", createdBy: "payer", maxBatchTotal: 1_000_000_000n, maxPerPayment: 500_000_000n, expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null },
  plan: { obligations: [{ id: "ob-1", amount: 100_000_000n, recipient: A }, { id: "ob-2", amount: 200_000_000n, recipient: A }], heldIds: [], source: "ai-exec-1" },
  signalCount: 0,
  companyCeiling: 600_000_000n,
  payrollApproverId: "payroll",
  now: NOW,
});

type Case = [string, ReturnType<typeof checkStanding>[number], (i: StandingInput) => void];
const cases: Case[] = [
  ["revoked", "REVOKED", (i) => (i.standing.revokedAt = new Date("2026-10-01T00:00:00Z"))],
  ["expired", "EXPIRED", (i) => (i.standing.expiresAt = new Date("2026-10-10T11:59:59Z"))],
  ["expires exactly now", "EXPIRED", (i) => (i.standing.expiresAt = NOW)],
  ["holds in the plan", "HAS_HOLDS", (i) => (i.plan.heldIds = ["ob-9"])],
  ["a fired signal (new recipient, 2x amount, first payment, config change)", "HAS_SIGNALS", (i) => (i.signalCount = 1)],
  ["the fallback plan (the planner failed)", "FALLBACK_PLAN", (i) => (i.plan.source = "FALLBACK")],
  ["batch above the authorized total", "OVER_BATCH_TOTAL", (i) => (i.standing.maxBatchTotal = 299_999_999n)],
  ["one payment above the authorized limit", "OVER_PAYMENT_LIMIT", (i) => (i.standing.maxPerPayment = 199_999_999n)],
  ["one payment above the company ceiling", "OVER_COMPANY_CEILING", (i) => (i.companyCeiling = 199_999_999n)],
  ["creator is the payroll approver", "CREATOR_IS_PAYROLL_APPROVER", (i) => (i.payrollApproverId = "payer")],
];

describe("S09 standing authorization", () => {
  it("a clean batch within the limits passes", () => expect(checkStanding(clean())).toEqual([]));

  it("limits are inclusive: exactly the total and exactly the per-payment limit still pass", () => {
    const i = clean();
    i.standing.maxBatchTotal = 300_000_000n;
    i.standing.maxPerPayment = 200_000_000n;
    i.companyCeiling = 200_000_000n;
    expect(checkStanding(i)).toEqual([]);
  });

  it.each(cases)("%s -> a human signs", (_label, code, mutate) => {
    const i = clean();
    mutate(i);
    expect(checkStanding(i)).toContain(code);
  });

  it("reports every reason at once, not just the first", () => {
    const i = clean();
    i.plan.heldIds = ["x"];
    i.signalCount = 2;
    i.plan.source = "FALLBACK";
    expect(checkStanding(i)).toEqual(["HAS_HOLDS", "HAS_SIGNALS", "FALLBACK_PLAN"]);
  });
});
