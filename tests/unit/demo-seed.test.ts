import { describe, expect, it } from "vitest";
import { assertDemoTarget } from "../../scripts/seed-demo";

describe("synthetic demo seed boundary", () => {
  it("accepts only a designated non-production demo with payments off", () => {
    const company = { is_demo: true, live_payments_enabled: false };
    expect(() => assertDemoTarget("http://127.0.0.1:54321", undefined, company)).not.toThrow();
    for (const c of [{ ...company, is_demo: false }, { ...company, live_payments_enabled: true }]) {
      expect(() => assertDemoTarget("http://127.0.0.1:54321", undefined, c)).toThrow();
    }
    expect(() => assertDemoTarget("https://prod.example", "https://prod.example/", company)).toThrow();
    expect(() => assertDemoTarget("https://prod.example", undefined, company)).toThrow();
    expect(() => assertDemoTarget("", undefined, company)).toThrow();
  });
});
