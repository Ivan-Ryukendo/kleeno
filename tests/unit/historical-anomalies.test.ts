import { describe, expect, it } from "vitest";
import { historicalFindings, type HistoricalThresholds } from "@/core/variance/anomalies";
import { compareHistory, type HistoricalRun } from "@/core/variance/history";
import type { PayrollLine } from "@/core/engine";

const line = (net: bigint): PayrollLine => ({ workerId: "W1", net, gross: net, deductions: 0n, trace: [{ component: "base", amount: net, source: "worker.compensation", rule: "BASE_SALARY", ruleVersion: 1, inputs: {}, step: 1 }] });
const run = (id: string, start: string, end: string, net: bigint): HistoricalRun => ({ id, companyId: "company-a", period: { start, end }, validated: true, calculationHash: `${id}-hash`, configVersion: 1, lines: [line(net)] });
const comparison = (before = 100n, after = 120n) => compareHistory(run("current", "2026-10-01", "2026-10-31", after), run("baseline", "2026-08-01", "2026-08-31", before));
const thresholds = (): HistoricalThresholds => ({ version: "threshold-v1", rules: [{ id: "net-change", component: null, absolute: 20n }] });
describe("configured historical findings", () => {
  it("has no invented default thresholds", () => {
    expect(historicalFindings(comparison(), null)).toEqual({ status: "DISABLED", reason: "Historical thresholds are not configured", findings: [] });
  });
  it("labels an explicitly empty rule list as disabled rather than evaluated assurance", () => {
    expect(historicalFindings(comparison(), { version: "v1", rules: [] })).toEqual({ status: "DISABLED", reason: "No historical alerts are configured", findings: [] });
  });
  it("keeps an absent baseline unavailable", () => {
    const v = compareHistory(run("current", "2026-10-01", "2026-10-31", 120n), null);
    expect(historicalFindings(v, thresholds())).toMatchObject({ status: "UNAVAILABLE", findings: [] });
  });
  it("binds inclusive exact findings to baseline/hash/configuration evidence", () => {
    expect(historicalFindings(comparison(), thresholds())).toMatchObject({ status: "EVALUATED", findings: [{ workerId: "W1", component: null, previous: 100n, current: 120n, delta: 20n, triggeredBy: ["ABSOLUTE"], thresholdId: "net-change", thresholdVersion: "threshold-v1", currentRunId: "current", baselineRunId: "baseline", currentHash: "current-hash", baselineHash: "baseline-hash" }] });
    expect(historicalFindings(comparison(100n, 119n), thresholds()).findings).toEqual([]);
  });
  it("treats increases and decreases symmetrically", () => {
    expect(historicalFindings(comparison(100n, 80n), thresholds()).findings[0].delta).toBe(-20n);
  });
  it("evaluates component percent boundaries with integer cross multiplication", () => {
    const v: HistoricalThresholds = { version: "v1", rules: [{ id: "base-percent", component: "base", percent: { n: 20n, d: 1n } }] };
    expect(historicalFindings(comparison(), v).findings[0]).toMatchObject({ component: "base", triggeredBy: ["PERCENT"], percent: { n: 2000n, d: 100n } });
    expect(historicalFindings(comparison(100n, 119n), v).findings).toEqual([]);
  });
  it("reports undefined percentage at zero baseline without masking an absolute finding", () => {
    const v = thresholds(); v.rules[0].percent = { n: 1n, d: 1n };
    expect(historicalFindings(comparison(0n, 20n), v).findings[0]).toMatchObject({ percent: null, triggeredBy: ["ABSOLUTE"] });
    delete v.rules[0].absolute;
    expect(historicalFindings(comparison(0n, 20n), v).findings).toEqual([]);
  });
  it("does not round money beyond Number precision or flag unchanged values", () => {
    const v = thresholds(); v.rules[0].absolute = 1n;
    expect(historicalFindings(comparison(9_007_199_254_740_993n, 9_007_199_254_740_994n), v).findings[0].delta).toBe(1n);
    v.rules[0].absolute = 0n;
    expect(historicalFindings(comparison(100n, 100n), v).findings).toEqual([]);
  });
  it.each(["negative", "denominator", "duplicate", "empty"])("rejects %s threshold configuration", problem => {
    const v = thresholds();
    if (problem === "negative") v.rules[0].absolute = -1n;
    if (problem === "denominator") v.rules[0].percent = { n: 1n, d: 0n };
    if (problem === "duplicate") v.rules.push(v.rules[0]);
    if (problem === "empty") delete v.rules[0].absolute;
    expect(() => historicalFindings(comparison(), v)).toThrow("threshold");
  });
  it("rejects a fabricated compared projection with foreign baseline", () => {
    const v = comparison(); v.baseline!.companyId = "foreign";
    expect(() => historicalFindings(v, thresholds())).toThrow("baseline");
  });
});
