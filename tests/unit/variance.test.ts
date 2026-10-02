import { describe, expect, it } from "vitest";
import { parseUsdc } from "@/core/money";
import { compareVariance } from "@/core/variance";

const u = parseUsdc;
const lines = [
  { workerId: "A", net: u("1700") },
  { workerId: "B", net: u("1530") },
  { workerId: "C", net: u("2000") },
  { workerId: "D", net: u("500") },
];

describe("variance report", () => {
  it("matching amounts, within tolerance, raise nothing", () => {
    expect(compareVariance(lines, new Map([["A", u("1700.00")], ["B", u("1530.01")], ["C", u("2000")], ["D", u("500")]]), u("0.01"))).toEqual([]);
  });

  it("flags underpaid, overpaid, not paid and paid-but-not-in-payroll, with exact differences", () => {
    const f = compareVariance(lines, new Map([["A", u("1500")], ["B", u("1600.50")], ["C", u("2000")], ["Z", u("300")]]), u("0.01"));
    expect(f).toEqual([
      { workerId: "A", kind: "UNDERPAID", expected: u("1700"), actual: u("1500"), difference: -u("200") },
      { workerId: "B", kind: "OVERPAID", expected: u("1530"), actual: u("1600.50"), difference: u("70.50") },
      { workerId: "D", kind: "NOT_PAID", expected: u("500"), actual: 0n, difference: -u("500") },
      { workerId: "Z", kind: "NOT_IN_PAYROLL", expected: 0n, actual: u("300"), difference: u("300") },
    ]);
  });

  it("the tolerance is a limit: just over it is a finding", () => {
    expect(compareVariance([{ workerId: "A", net: u("100") }], new Map([["A", u("100.02")]]), u("0.01"))).toHaveLength(1);
    expect(compareVariance([{ workerId: "A", net: u("100") }], new Map([["A", u("100.01")]]), u("0.01"))).toHaveLength(0);
  });

  it("a worker who should get nothing and was paid nothing is not a finding", () => {
    expect(compareVariance([{ workerId: "A", net: 0n }], new Map(), u("0.01"))).toEqual([]);
  });
});
