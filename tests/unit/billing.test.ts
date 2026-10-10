import { describe, expect, it } from "vitest";
import { BillingCommandSchema, PriceSchema, demoState, estimateCents, usageMonth } from "@/core/billing";
describe("subscription foundations", () => {
  it("keeps USD cents integer and bounded", () => {
    expect(PriceSchema.parse({ name: "Review", baseCents: 4900, workerCents: 200 })).toEqual({ name: "Review", baseCents: 4900, workerCents: 200 });
    for (const baseCents of [-1, 0.1, Number.MAX_SAFE_INTEGER]) expect(PriceSchema.safeParse({ name: "Review", baseCents, workerCents: 200 }).success).toBe(false);
    expect(estimateCents(4900, 200, 3)).toBe(5500);
    expect(() => estimateCents(4900, 200, -1)).toThrow();
  });
  it("uses server UTC calendar month, not payroll period", () => {
    expect(usageMonth("2026-11-01T00:30:00+01:00")).toBe("2026-10-01");
    expect(usageMonth("2026-11-01T00:00:00Z")).toBe("2026-11-01");
    expect(() => usageMonth("bad")).toThrow();
  });
  it("expires exactly at 48 hours and never converts", () => {
    expect(demoState(null, "2026-10-08T00:00:00Z")).toBe("NOT_ACTIVATED");
    expect(demoState("2026-10-06T00:00:00Z", "2026-10-07T23:59:59Z")).toBe("ACTIVE");
    expect(demoState("2026-10-06T00:00:00Z", "2026-10-08T00:00:00Z")).toBe("EXPIRED");
  });
  it("rejects missing reason and authority injection", () => {
    const command = { action: "create", id: "00000000-0000-4000-8000-000000000001", expectedRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000002", reason: "Owner pricing test", price: { name: "Review", baseCents: 4900, workerCents: 200 } };
    expect(BillingCommandSchema.safeParse(command).success).toBe(true);
    expect(BillingCommandSchema.safeParse({ ...command, reason: "" }).success).toBe(false);
    expect(BillingCommandSchema.safeParse({ ...command, livePaymentsEnabled: true }).success).toBe(false);
  });
});
