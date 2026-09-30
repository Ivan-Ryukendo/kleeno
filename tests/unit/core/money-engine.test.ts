import { describe, expect, it } from "vitest";
import { calculatePayroll } from "@/core/engine";
import { formatUsdc, parseUsdc, roundHalfUpToCent } from "@/core/money";

describe("money", () => {
  it("parses and formats exactly", () => {
    expect(parseUsdc("100")).toBe(100_000_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(formatUsdc(100_000_000n)).toBe("100.00");
    expect(formatUsdc(1_234_567n)).toBe("1.234567");
    expect(formatUsdc(-5_000_000n)).toBe("-5.00");
  });

  it("rejects floats, exponents, negatives and >6 dp", () => {
    for (const bad of ["1e3", "-1", "1.1234567", "", "1,5", " 1"]) expect(() => parseUsdc(bad)).toThrow();
  });

  it("rounds half-up to 0.01", () => {
    expect(roundHalfUpToCent(parseUsdc("1.005"))).toBe(parseUsdc("1.01"));
    expect(roundHalfUpToCent(parseUsdc("1.004999"))).toBe(parseUsdc("1.00"));
  });
});

describe("engine (P1)", () => {
  const workers = [
    { workerId: "w2", payType: "RETAINER" as const, baseAmount: parseUsdc("50") },
    { workerId: "w1", payType: "SALARIED" as const, baseAmount: parseUsdc("100.005") },
  ];

  it("net = gross - deductions and every line has a trace summing to gross", () => {
    for (const l of calculatePayroll(1, workers).lines) {
      expect(l.net).toBe(l.gross - l.deductions);
      expect(l.trace.reduce((s, t) => s + t.amount, 0n)).toBe(l.gross);
    }
  });

  it("same input, same hash regardless of input order; changed input, new hash", () => {
    const a = calculatePayroll(1, workers);
    expect(calculatePayroll(1, [...workers].reverse()).calculationHash).toBe(a.calculationHash);
    expect(calculatePayroll(2, workers).calculationHash).not.toBe(a.calculationHash);
  });

  it("HOURLY is rejected until P2", () => {
    expect(() => calculatePayroll(1, [{ workerId: "w", payType: "HOURLY", baseAmount: 1n }])).toThrow();
  });
});
