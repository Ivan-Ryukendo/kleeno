import { describe, expect, it } from "vitest";
import { div, formatUsdc, mul, parseDecimal, parseUsdc, ratio, roundHalfUpToCent, roundRatioToCent } from "@/core/money";

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

describe("ratio", () => {
  it("keeps repeating rates exact and rounds once, half-up", () => {
    const rate = div(ratio(1_000_000_000n), parseDecimal("7")); // 1000 / 7
    expect(roundRatioToCent(rate)).toBe(parseUsdc("142.86"));
    expect(roundRatioToCent(mul(rate, parseDecimal("7")))).toBe(parseUsdc("1000"));
  });

  it("rejects malformed decimals", () => {
    for (const bad of ["1e3", "-1", "1.", ".5", "", "1,5"]) expect(() => parseDecimal(bad)).toThrow();
  });
});
