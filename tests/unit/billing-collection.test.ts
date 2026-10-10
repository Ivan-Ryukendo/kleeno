import { expect, it } from "vitest";
import { BillingCollectionSchema, closedUsageMonth, usageCharge } from "@/core/billing-collection";
it("requires a closed UTC month and rejects caller amounts/company authority", () => {
  expect(closedUsageMonth("2026-09-01", "2026-10-01T00:00:00Z")).toBe("2026-09-01");
  for (const month of ["2026-10-01", "2026-11-01", "2026-09-02", "2026-13-01"]) expect(() => closedUsageMonth(month, "2026-10-01T00:00:00Z")).toThrow();
  expect(BillingCollectionSchema.safeParse({ action: "usage", month: "2026-09-01", idempotencyKey: "11111111-1111-4111-8111-111111111111", amountCents: 1 }).success).toBe(false);
});
it("charges each unique worker at their immutable usage-assignment price, never current tier", () => {
  const prices = new Map([['original', { name: 'Original', baseCents: 4900, workerCents: 200 }], ['enterprise', { name: 'Enterprise', baseCents: 9900, workerCents: 150 }]]);
  expect(usageCharge([{ workerId: 'one', assignmentId: 'original' }, { workerId: 'two', assignmentId: 'enterprise' }], prices)).toEqual({ amountCents: 350, uniqueWorkers: 2 });
  expect(() => usageCharge([{ workerId: 'one', assignmentId: 'original' }, { workerId: 'one', assignmentId: 'enterprise' }], prices)).toThrow();
  expect(() => usageCharge([{ workerId: 'one', assignmentId: 'missing' }], prices)).toThrow();
});
