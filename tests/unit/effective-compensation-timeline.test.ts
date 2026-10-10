import { expect, it } from "vitest";
import { compensationSegments, type EffectiveRate } from "@/core/workers/effective-compensation";

const base: EffectiveRate = { id: "10000000-0000-4000-8000-000000000001", version: 1, effectiveFrom: "2020-01-01", payType: "SALARIED", baseAmount: "3100000000", hourlyRate: "0", supersedesId: null };
const change: EffectiveRate = { ...base, id: "20000000-0000-4000-8000-000000000002", version: 2, effectiveFrom: "2026-01-16", baseAmount: "6200000000" };
const period = { start: "2026-01-01", end: "2026-01-31" };
it("pins baseline before the first change and never applies a future highest version early", () => {
  const segments = compensationSegments(base, [change, { ...change, id: "30000000-0000-4000-8000-000000000003", version: 3, effectiveFrom: "2026-02-01", baseAmount: "9300000000" }], period);
  expect(segments.map(value => [value.start, value.end, value.baseAmount])).toEqual([["2026-01-01", "2026-01-15", "3100000000"], ["2026-01-16", "2026-01-31", "6200000000"]]);
  expect(compensationSegments(base, [change], { start: "2026-02-01", end: "2026-02-28" })[0]).toMatchObject({ sourceId: change.id, baseAmount: change.baseAmount });
});
it("requires explicit same-date supersession and selects independently of input order", () => {
  const corrected = { ...change, id: "30000000-0000-4000-8000-000000000003", version: 3, supersedesId: change.id, baseAmount: "6500000000" };
  expect(compensationSegments(base, [corrected, change], period)).toEqual(compensationSegments(base, [change, corrected], period));
  expect(compensationSegments(base, [corrected, change], period).at(-1)?.baseAmount).toBe("6500000000");
  expect(() => compensationSegments(base, [change, { ...corrected, supersedesId: null }], period)).toThrow();
  expect(() => compensationSegments(base, [{ ...corrected, effectiveFrom: "2026-01-17" }, change], period)).toThrow();
});
it("blocks missing baseline, superseded missing references, duplicate IDs and mixed pay type", () => {
  for (const changes of [[change, change], [{ ...change, supersedesId: "40000000-0000-4000-8000-000000000004" }], [{ ...change, payType: "HOURLY" as const }]]) expect(() => compensationSegments(base, changes, period)).toThrow();
  expect(() => compensationSegments({ ...base, effectiveFrom: "2026-01-02" }, [change], period)).toThrow();
});

it("rejects duplicate immutable schedule revisions and uses the pinned baseline for a future-only timeline", () => {
  expect(() => compensationSegments(base, [change, { ...change, id: "30000000-0000-4000-8000-000000000003", effectiveFrom: "2026-01-17" }], period)).toThrow();
  expect(compensationSegments(base, [{ ...change, effectiveFrom: "2026-02-01" }], period)).toEqual([expect.objectContaining({ start: period.start, end: period.end, sourceId: base.id, baseAmount: base.baseAmount })]);
});
