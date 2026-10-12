import { describe, expect, it } from "vitest";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CONFIG } from "../../fixtures/payroll/cases";

const config = { ...CONFIG, deductions: [], prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };
const entry: EngineEntry = { worker: { workerId: "w1", payType: "SALARIED", baseAmount: parseUsdc("3100"), hourlyRate: 0n, employmentStart: "2026-01-16", employmentEnd: null }, period: { start: "2026-01-01", end: "2026-01-31" }, input: {} };
describe("HR additions and actual calendar-day proration", () => {
  it("prorates inclusive employment days and rounds each adjustment half up", () => {
    const adjusted = { ...entry, input: { adjustments: [{ id: "bonus", kind: "BONUS" as const, amount: "100.005", reason: "Approved bonus" }, { id: "fixed", kind: "FIXED_DEDUCTION" as const, amount: "10.005", reason: "Equipment repayment" }] } };
    const calc = calculatePayroll(config, [adjusted]);
    expect(calc.lines[0]).toMatchObject({ gross: parseUsdc("1700.01"), deductions: parseUsdc("10.01"), net: parseUsdc("1690") });
    expect(calc.lines[0].trace.reduce((s, t) => s + t.amount, 0n)).toBe(calc.lines[0].net);
    expect(calc.calculationHash).not.toBe(calculatePayroll(config, [entry]).calculationHash);
    expect(calc.calculationHash).not.toBe(calculatePayroll(config, [{ ...adjusted, input: { adjustments: adjusted.input.adjustments.map(a => ({ ...a, reason: a.reason + " reviewed" })) } }]).calculationHash);
  });
  it("handles full, zero, one-day, leap month and retainer periods", () => {
    const pay = (start: string | null, end: string | null, period = entry.period, payType = "SALARIED" as "SALARIED" | "RETAINER") => calculatePayroll(config, [{ ...entry, period, worker: { ...entry.worker, payType, employmentStart: start, employmentEnd: end } }]).lines[0].gross;
    expect(pay(null, null)).toBe(parseUsdc("3100"));
    expect(pay("2026-02-01", null)).toBe(0n);
    expect(pay("2026-01-31", "2026-01-31")).toBe(parseUsdc("100"));
    expect(pay("2024-02-29", null, { start: "2024-02-01", end: "2024-02-29" }, "RETAINER")).toBe(parseUsdc("106.90"));
  });
  it("refuses undated unpaid leave for partial employment and excludes dated leave outside employment", () => {
    expect(() => calculatePayroll(config, [{ ...entry, input: { unpaidLeaveHours: "8" } }])).toThrow(/dated unpaid leave/);
    expect(calculatePayroll(config, [{ ...entry, input: { unpaidLeaveHours: "8", unpaidLeave: [{ date: "2026-01-10", hours: "8" }] } }]).lines[0].gross).toBe(parseUsdc("1600"));
    expect(calculatePayroll(config, [{ ...entry, input: { unpaidLeaveHours: "8", unpaidLeave: [{ date: "2026-01-20", hours: "8" }] } }]).lines[0].gross).toBe(parseUsdc("980"));
  });
  it("rejects missing reason, duplicate adjustment IDs, excess deductions and ambiguous dates", () => {
    for (const adjustments of [[{ id: "x", kind: "BONUS", amount: "1", reason: "" }], [{ id: "x", kind: "BONUS", amount: "1", reason: "Approved" }, { id: "x", kind: "BONUS", amount: "1", reason: "Approved" }], [{ id: "x", kind: "FIXED_DEDUCTION", amount: "2000", reason: "Approved" }]]) expect(() => calculatePayroll(config, [{ ...entry, input: { adjustments } } as EngineEntry])).toThrow();
    expect(() => calculatePayroll(config, [{ ...entry, worker: { ...entry.worker, employmentStart: "2026-02-30" } }])).toThrow();
  });
});
