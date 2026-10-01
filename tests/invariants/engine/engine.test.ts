// PROTECTED. Engine fixtures + invariants (ARCHITECTURE 20): net = gross - deductions, every amount traced,
// same inputs -> same hash, unexplained time never becomes a deduction.
import { describe, expect, it } from "vitest";
import { calculatePayroll, EngineBlocked, verifyCalculation } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { CASES, CONFIG } from "../../fixtures/payroll/cases";

describe("engine fixtures", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const cfg = c.config ?? CONFIG;
      const calc = calculatePayroll(cfg, [c.entry]);
      const line = calc.lines[0];
      expect([line.gross, line.deductions, line.net]).toEqual([parseUsdc(c.gross), parseUsdc(c.deductions), parseUsdc(c.net)]);
      expect(line.net).toBe(line.gross - line.deductions);
      expect(line.trace.reduce((s, t) => s + t.amount, 0n)).toBe(line.net); // every cent traced
      expect(verifyCalculation(cfg, [c.entry], calc)).toEqual([]);
    });
  }

  it("same inputs give the same hash in any order; any input change gives a new hash", () => {
    const entries = CASES.filter((c) => !c.config).map((c) => c.entry);
    const a = calculatePayroll(CONFIG, entries);
    expect(calculatePayroll(CONFIG, [...entries].reverse()).calculationHash).toBe(a.calculationHash);
    expect(calculatePayroll({ ...CONFIG, version: 2 }, entries).calculationHash).not.toBe(a.calculationHash);
    const changed = entries.map((e, i) => (i === 0 ? { ...e, input: { workedHours: "41" } } : e));
    expect(calculatePayroll(CONFIG, changed).calculationHash).not.toBe(a.calculationHash);
  });

  it("unexplained hours are never a deduction: the engine refuses (rule 11)", () => {
    const w = CASES[3].entry.worker;
    expect(() => calculatePayroll(CONFIG, [{ worker: w, input: { workedHours: "36", unexplainedHours: "4" } }])).toThrow(EngineBlocked);
  });

  it("refuses inputs it cannot price without guessing", () => {
    const hourly = CASES[4].entry.worker;
    expect(() => calculatePayroll(CONFIG, [{ worker: hourly, input: { workedHours: "41", approvedAboveCapHours: "2" } }])).toThrow(EngineBlocked);
    const retainer = { ...CASES[5].entry.worker, hourlyRate: 0n };
    expect(() => calculatePayroll(CONFIG, [{ worker: retainer, input: { approvedExtraHours: "1" } }])).toThrow(EngineBlocked);
    const salaried = CASES[3].entry.worker;
    expect(() => calculatePayroll(CONFIG, [{ worker: salaried, input: { unpaidLeaveHours: "41" } }])).toThrow(EngineBlocked); // negative gross
  });

  it("verifyCalculation catches a tampered line", () => {
    const e = CASES[0].entry;
    const calc = calculatePayroll(CONFIG, [e]);
    calc.lines[0] = { ...calc.lines[0], net: calc.lines[0].net + 1n };
    expect(verifyCalculation(CONFIG, [e], calc).length).toBeGreaterThan(0);
  });
});
