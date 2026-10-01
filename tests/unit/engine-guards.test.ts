// Fail-closed engine guards found in the P2 review: nothing is silently ignored, nobody is paid twice.
import { describe, expect, it } from "vitest";
import { calculatePayroll, EngineBlocked, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CONFIG } from "../fixtures/payroll/cases";

const worker = (id: string, payType: "SALARIED" | "HOURLY" | "RETAINER") => ({ workerId: id, payType, baseAmount: parseUsdc("1000"), hourlyRate: parseUsdc("20") });

describe("engine guards", () => {
  it("two entries for one worker are refused (would pay twice)", () => {
    const e: EngineEntry = { worker: worker("w1", "SALARIED"), input: { workedHours: "40" } };
    expect(() => calculatePayroll(CONFIG, [e, e])).toThrow(EngineBlocked);
  });

  it.each([
    ["SALARIED", { workedHours: "40", approvedExtraHours: "2" }],
    ["SALARIED", { workedHours: "40", approvedAboveCapHours: "2" }],
    ["HOURLY", { workedHours: "40", paidLeaveHours: "8" }],
    ["HOURLY", { workedHours: "40", approvedOvertimeHours: "2" }],
    ["RETAINER", { workedHours: "40", unpaidLeaveHours: "4" }],
    ["RETAINER", { workedHours: "40", approvedOvertimeHours: "2" }],
  ] as const)("%s refuses an input that does not apply to it: %j", (payType, input) => {
    expect(() => calculatePayroll(CONFIG, [{ worker: worker("w1", payType), input }])).toThrow(EngineBlocked);
  });

  it("zero-valued inapplicable inputs are fine", () => {
    expect(() => calculatePayroll(CONFIG, [{ worker: worker("w1", "HOURLY"), input: { workedHours: "10", paidLeaveHours: "0" } }])).not.toThrow();
  });
});
