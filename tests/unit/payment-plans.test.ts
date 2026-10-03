import { describe, expect, it } from "vitest";
import { buildFallbackPlan, checkPlan, PlanError, planTotal, type Payable } from "@/core/payments/batches";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const ob = (id: string, amount: bigint, recipient = A): Payable => ({ id, amount, recipient });
const all = [ob("c", 30n), ob("a", 10n), ob("b", 20n, B)];

describe("buildFallbackPlan", () => {
  it("one batch in obligation-ID order, every obligation once, amounts and recipients unchanged", () => {
    const { plan, planHash } = buildFallbackPlan(all, []);
    expect(plan.obligations.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(plan.obligations.find((o) => o.id === "b")).toEqual({ id: "b", amount: 20n, recipient: B });
    expect(plan.source).toBe("FALLBACK");
    expect(planTotal(plan)).toBe(60n);
    expect(checkPlan(plan, planHash, all)).toEqual([]);
  });

  it("holds leave the batch and are listed once; batch + holds always cover the run exactly", () => {
    const { plan, planHash } = buildFallbackPlan(all, ["b", "b"]);
    expect(plan.obligations.map((o) => o.id)).toEqual(["a", "c"]);
    expect(plan.heldIds).toEqual(["b"]);
    expect(checkPlan(plan, planHash, all)).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    expect(buildFallbackPlan([...all].reverse(), ["a"]).planHash).toBe(buildFallbackPlan(all, ["a"]).planHash);
  });

  it("refuses an unknown hold and a plan with nothing to pay", () => {
    expect(() => buildFallbackPlan(all, ["zzz"])).toThrow(PlanError);
    expect(() => buildFallbackPlan(all, ["a", "b", "c"])).toThrow(PlanError);
  });
});

describe("checkPlan (signing re-checks the stored plan)", () => {
  const { plan, planHash } = buildFallbackPlan(all, ["b"]);

  it("a changed amount or recipient fails", () => {
    expect(checkPlan(plan, planHash, [ob("a", 11n), ob("b", 20n, B), ob("c", 30n)])).toContain("AMOUNT_CHANGED");
    expect(checkPlan(plan, planHash, [ob("a", 10n, B), ob("b", 20n, B), ob("c", 30n)])).toContain("RECIPIENT_CHANGED");
  });
  it("an obligation the plan does not account for, or an unknown one, fails", () => {
    expect(checkPlan(plan, planHash, [...all, ob("d", 5n)])).toContain("MISSING_OBLIGATION");
    expect(checkPlan(plan, planHash, [ob("a", 10n), ob("b", 20n, B)])).toContain("UNKNOWN_OBLIGATION");
  });
  it("an edited plan fails its hash; an obligation both in the batch and on hold counts as a duplicate", () => {
    expect(checkPlan({ ...plan, source: "AI" }, planHash, all)).toContain("PLAN_HASH_MISMATCH");
    const dup = { ...plan, heldIds: ["a", "b"] };
    expect(checkPlan(dup, planHash, all)).toContain("DUPLICATE_OBLIGATION");
  });
});
