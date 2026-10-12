import { describe, expect, it } from "vitest";
import { compareHistory, type HistoricalRun } from "@/core/variance/history";
import type { PayrollLine } from "@/core/engine";
const line = (workerId: string, base: bigint, deduction = 0n): PayrollLine => ({ workerId, gross: base, deductions: deduction, net: base - deduction, trace: [
  { component: "base", amount: base, source: "worker.compensation", rule: "BASE_SALARY", ruleVersion: 1, inputs: {}, step: 1 },
  { component: "tax", amount: -deduction, source: "config", rule: "TAX", ruleVersion: 1, inputs: {}, step: 2 },
] });
const run = (id: string, start: string, end: string, lines: PayrollLine[]): HistoricalRun => ({ id, companyId: "company-a", period: { start, end }, validated: true, calculationHash: id, configVersion: 1, lines });
const prior = () => run("prior", "2026-08-01", "2026-08-31", [line("W1", 100n, 10n), line("W2", 50n)]);
const current = () => run("current", "2026-10-01", "2026-10-31", [line("W1", 120n, 20n), line("W3", 30n)]);
describe("exact historical comparison", () => {
  it("labels absent baseline without invented zeros", () => {
    expect(compareHistory(current(), null)).toMatchObject({ status: "NO_BASELINE", baseline: null, totals: null, workers: [] });
  });
  it.each(["tenant", "length", "validation", "future"])("rejects %s baseline", reason => {
    const p = prior();
    if (reason === "tenant") p.companyId = "company-b";
    if (reason === "length") p.period.end = "2026-08-30";
    if (reason === "validation") p.validated = false;
    if (reason === "future") p.period = current().period;
    expect(compareHistory(current(), p)).toMatchObject({ status: "INCOMPARABLE", baseline: null, totals: null });
  });
  it("requires a validated current result", () => {
    expect(compareHistory({ ...current(), validated: false }, prior()).status).toBe("CURRENT_UNVALIDATED");
  });
  it("compares additions/removals and signed components which reconcile exactly", () => {
    const r = compareHistory(current(), prior());
    expect(r.status).toBe("COMPARED");
    expect(r.totals!.net).toEqual({ previous: 140n, current: 130n, delta: -10n });
    expect(r.workers.map(w => [w.workerId, w.change])).toEqual([["W1", "CHANGED"], ["W2", "REMOVED"], ["W3", "ADDED"]]);
    expect(r.workers[0].components.map(c => [c.component, c.delta])).toEqual([["base", 20n], ["tax", -10n]]);
    expect(r.workers.reduce((s, w) => s + w.components.reduce((v, c) => v + c.delta, 0n), 0n)).toBe(r.totals!.net.delta);
  });
  it("keeps exact large money and zero-denominator percentage explicit", () => {
    const huge = 9_007_199_254_740_993n;
    const r = compareHistory(run("current", "2026-10-01", "2026-10-31", [line("W1", huge)]), run("prior", "2026-08-01", "2026-08-31", [line("W1", 0n)]));
    expect(r.totals!.net.delta).toBe(huge); expect(r.workers[0].netPercent).toBeNull();
  });
  it("retains the explicitly selected comparable run", () => {
    const older = run("older", "2026-07-01", "2026-07-31", [line("W1", 20n)]);
    expect(compareHistory(current(), older).baseline?.id).toBe("older");
  });
  it("refuses inconsistent trace or duplicate worker records", () => {
    const c = current(); c.lines[0].trace[0].amount = 1n;
    expect(() => compareHistory(c, prior())).toThrow("trace");
    const p = prior(); p.lines.push(p.lines[0]);
    expect(() => compareHistory(current(), p)).toThrow("duplicate");
  });
});
