import { expect, it } from "vitest";
import { assertCorrectionPair, correctionDelta, CorrectionCommandSchema } from "@/core/workflow/corrections";

const id = "10000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000002";
const original = { id, companyId: id, mode: "LIVE_TESTNET", status: "SETTLED", periodStart: "2026-10-01", periodEnd: "2026-10-31", calculationId: id, calculationHash: "a".repeat(64), configVersion: 1, reviewRevision: 2, signoffId: id };
const replacement = { ...original, id: other, mode: "SIMULATION", status: "CALCULATION_VALIDATED", calculationId: other, calculationHash: "b".repeat(64), reviewRevision: 0, signoffId: null };
const command = { replacementRunId: other, originalCalculationId: id, originalCalculationHash: original.calculationHash, replacementCalculationId: other, replacementCalculationHash: replacement.calculationHash, originalReviewRevision: 2, replacementReviewRevision: 0 as const, idempotencyKey: id, reason: "Correction reviewed", source: "Ticket 12" };

it("accepts only a separately calculated unsigned simulation replacement of the same signed period", () => {
  expect(() => assertCorrectionPair(original, replacement, command)).not.toThrow();
  for (const patch of [{ id }, { companyId: other }, { mode: "LIVE_TESTNET" }, { status: "DRAFT" }, { periodStart: "2026-09-01" }, { periodEnd: "2026-11-01" }, { signoffId: other }, { reviewRevision: 1 }, { calculationHash: original.calculationHash }]) {
    expect(() => assertCorrectionPair(original, { ...replacement, ...patch }, command)).toThrow();
  }
  expect(() => assertCorrectionPair({ ...original, signoffId: null }, replacement, command)).toThrow();
  expect(() => assertCorrectionPair({ ...original, status: "REJECTED" }, replacement, command)).toThrow();
  expect(() => assertCorrectionPair({ ...original, reviewRevision: 3 }, replacement, command)).toThrow();
});

it("computes exact immutable deltas and explicitly distinguishes added/removed workers", () => {
  const line = (workerId: string, gross: bigint, deductions = 0n) => ({ workerId, gross, deductions, net: gross - deductions });
  const delta = correctionDelta([line("W001", 900719925474099312345n, 10n), line("W002", 20n)], [line("W001", 900719925474099312350n, 12n), line("W003", 30n)]);
  expect(delta.totals).toEqual({ gross: "15", deductions: "2", net: "13" });
  expect(delta.workers.map(value => [value.workerId, value.change])).toEqual([["W001", "CHANGED"], ["W002", "REMOVED"], ["W003", "ADDED"]]);
  expect(delta.workers[0].delta.net).toBe("3");
  expect(() => correctionDelta([line("W001", 1n), line("W001", 1n)], [line("W001", 2n)])).toThrow();
  expect(() => correctionDelta([], [line("W001", 2n)])).toThrow();
});

it("rejects unbounded/private extra command fields and preserves required human reason/source", () => {
  expect(CorrectionCommandSchema.parse(command)).toEqual(command);
  for (const patch of [{ reason: " " }, { source: "" }, { reason: "x".repeat(2001) }, { amount: "123" }, { companyId: other }, { replacementReviewRevision: -1 }]) expect(CorrectionCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
});
