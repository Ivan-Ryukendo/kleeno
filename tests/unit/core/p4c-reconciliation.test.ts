import { expect, it } from "vitest";
import { analyse, type ReconInput } from "@/core/reconciliation";
import { calculatePayroll } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CONFIG } from "../../fixtures/payroll/cases";
it("partial employment keeps effective dated leave and does not invent an active attendance schedule", () => {
  const config = { ...CONFIG, deductions: [], prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };
  const input: ReconInput = { config, period: { start: "2026-01-01", end: "2026-01-31" }, workers: [{ id: "w1", payType: "SALARIED", employmentStart: "2026-01-16" }], timesheets: [], leave: [{ id: "l1", workerId: "w1", date: "2026-01-10", leaveType: "UNPAID", hours: "8", seq: 1 }] };
  const analysis = analyse(input);
  expect(analysis.exceptions).toEqual([]);
  expect(analysis.inputs?.get("w1")?.unpaidLeave).toEqual([{ date: "2026-01-10", hours: "8" }]);
  const calculation = calculatePayroll(config, [{ worker: { workerId: "w1", payType: "SALARIED", baseAmount: parseUsdc("3100"), hourlyRate: 0n, employmentStart: "2026-01-16" }, period: input.period, input: analysis.inputs!.get("w1")! }]);
  expect(calculation.lines[0].gross).toBe(parseUsdc("1600"));
});
it("reconciliation prices scoped hourly caps using the same deterministic winner as calculation", () => {
  const config = { ...CONFIG, scopedRules: [{ id: "personal", scope: { workers: ["W001"] }, values: { hourlyCapHours: "8" }, clauseIds: ["C1"] }] };
  const input: ReconInput = { config, period: { start: "2026-01-01", end: "2026-01-31" }, workers: [{ id: "w1", pseudonym: "W001", payType: "HOURLY" }], timesheets: [{ id: "t1", workerId: "w1", date: "2026-01-20", hours: "10", approvedExtraHours: "0", seq: 1 }], leave: [] };
  expect(analyse(input).exceptions[0]).toMatchObject({ category: "UNAPPROVED_OVERTIME", evidence: { facts: { overtimeHours: "2" } } });
});
