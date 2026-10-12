import { describe, expect, it, vi } from "vitest";
import { assertDemoTarget, seedSimulationDemo } from "../../scripts/seed-demo";

describe("synthetic demo seed boundary", () => {
  it("rejects remote targets before initializing server repositories", async () => {
    vi.stubEnv("SUPABASE_URL", "https://remote.example");
    vi.stubEnv("DATA_ENCRYPTION_KEY", "invalid-before-server-import");
    try {
      await expect(seedSimulationDemo("synthetic-company", "synthetic-owner")).rejects.toThrow("seed requires a designated local demo company");
    } finally {
      vi.unstubAllEnvs();
    }
  });
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
