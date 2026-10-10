import { expect, it } from "vitest";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CONFIG } from "../fixtures/payroll/cases";

const sourceId = "10000000-0000-4000-8000-000000000001";
const segment = (start: string, end: string, amount: string, version = 1, payType = "SALARIED", hourlyRate = "0") => ({ start, end, sourceId, sourceVersion: version, effectiveFrom: start, payType, baseAmount: parseUsdc(amount).toString(), hourlyRate: parseUsdc(hourlyRate).toString() });
const entry = (patch: object = {}) => ({ worker: { workerId: "W001", payType: "SALARIED", baseAmount: parseUsdc("3100"), hourlyRate: 0n }, input: {}, period: { start: "2026-01-01", end: "2026-01-31" }, compensationSegments: [segment("2026-01-01", "2026-01-15", "3100"), segment("2026-01-16", "2026-01-31", "6200", 2)], ...patch } as unknown as EngineEntry);
const config = { ...CONFIG, scheduledHoursPerPeriod: "160", deductions: [], prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };

it("prices salary each segment against whole-period inclusive calendar days, with one-off and percentage deductions once", () => {
  const value = entry({ input: { adjustments: [{ id: "bonus", kind: "BONUS", amount: "100", reason: "Reviewed" }, { id: "fixed", kind: "FIXED_DEDUCTION", amount: "20", reason: "Reviewed" }] } });
  const line = calculatePayroll({ ...config, deductions: [{ code: "TAX", label: "Tax", percent: "10" }] }, [value]).lines[0];
  expect(line.gross).toBe(parseUsdc("4800")); expect(line.deductions).toBe(parseUsdc("500")); expect(line.net).toBe(parseUsdc("4300"));
  expect(line.trace.reduce((sum, row) => sum + row.amount, 0n)).toBe(line.net);
});
it("rounds each segment component to cents and respects employment bounds and leap-month day count", () => {
  const value = entry({ period: { start: "2024-02-01", end: "2024-02-29" }, compensationSegments: [segment("2024-02-01", "2024-02-14", "1"), segment("2024-02-15", "2024-02-29", "1", 2)], worker: { ...entry().worker, employmentStart: "2024-02-14" } });
  expect(calculatePayroll(config, [value]).lines[0].gross).toBe(parseUsdc("0.55"));
});
it("requires exact complete dated priced inputs and rejects pooled or inapplicable inputs and discontinuous segments", () => {
  for (const patch of [{ input: { approvedOvertimeHours: "1" } }, { input: { unpaidLeaveHours: "1" } }, { input: { paidLeaveHours: "1" } }, { compensationSegments: [segment("2026-01-02", "2026-01-31", "6200")] }, { compensationSegments: [segment("2026-01-01", "2026-01-20", "3100"), segment("2026-01-16", "2026-01-31", "6200", 2)] }, { compensationSegments: [segment("2026-01-01", "2026-01-15", "3100"), segment("2026-01-16", "2026-01-31", "0", 2, "HOURLY", "20")] }]) expect(() => calculatePayroll(config, [entry(patch)])).toThrow();
});
it("prices reviewed dated unpaid leave at its effective salary and excludes leave outside active employment", () => {
  const value = entry({ worker: { ...entry().worker, employmentStart: "2026-01-16" }, input: { unpaidLeaveHours: "16", datedHours: [{ date: "2026-01-10", unpaidLeaveHours: "8" }, { date: "2026-01-20", unpaidLeaveHours: "8" }] } });
  expect(calculatePayroll(config, [value]).lines[0].gross).toBe(parseUsdc("2890"));
});
it("consumes a single hourly cap chronologically and never relocates earlier approvals to later higher rates", () => {
  const value = entry({ worker: { ...entry().worker, payType: "HOURLY", baseAmount: 0n, hourlyRate: parseUsdc("10") }, compensationSegments: [segment("2026-01-01", "2026-01-15", "0", 1, "HOURLY", "10"), segment("2026-01-16", "2026-01-31", "0", 2, "HOURLY", "20")], input: { workedHours: "12", approvedAboveCapHours: "2", datedHours: [{ date: "2026-01-10", workedHours: "6" }, { date: "2026-01-20", workedHours: "6", approvedAboveCapHours: "2" }] } });
  expect(calculatePayroll({ ...config, hourlyCapHours: "8", aboveCapMultiplier: "1.5" }, [value]).lines[0].gross).toBe(parseUsdc("160"));
  expect(() => calculatePayroll({ ...config, hourlyCapHours: "8" }, [{ ...value, input: { ...value.input, datedHours: [{ date: "2026-01-10", workedHours: "6", approvedAboveCapHours: "2" }, { date: "2026-01-20", workedHours: "6" }] } } as EngineEntry])).toThrow();
});

it("preserves aggregate overtime/leave pricing for one full-period immutable rate and binds the source without mutating inputs", () => {
  const value = entry({ compensationSegments: [segment("2026-01-01", "2026-01-31", "6200")], input: { approvedOvertimeHours: "2", unpaidLeaveHours: "8", paidLeaveHours: "8", adjustments: [{ id: "bonus", kind: "BONUS", amount: "100", reason: "Reviewed" }] } });
  const before = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
  const actual = calculatePayroll({ ...config, prorationMethod: undefined, deductions: [{ code: "TAX", label: "Tax", percent: "10" }] }, [value]);
  const legacy = calculatePayroll({ ...config, prorationMethod: undefined, deductions: [{ code: "TAX", label: "Tax", percent: "10" }] }, [{ worker: { ...value.worker, baseAmount: parseUsdc("6200") }, input: value.input, period: value.period }]);
  expect(actual.totals).toEqual(legacy.totals); expect(actual.calculationHash).not.toBe(legacy.calculationHash);
  expect(actual.lines[0].trace.find(row => row.rule === "OVERTIME")?.inputs).toMatchObject({ compensationSourceId: sourceId, compensationVersion: "1" });
  expect(actual.lines[0].trace.filter(row => row.rule === "PERCENT_DEDUCTION")).toHaveLength(1);
  expect(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)).toBe(before);
});
