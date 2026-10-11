import { describe, expect, it, vi } from "vitest";
import { assertDemoLocation } from "../../scripts/seed-demo";
import { assertJudgeCompany, seedJudge } from "../../scripts/seed-judge";

// R4.3: the judge seed writes only to loopback, the pinned kleeno-test project, or an owner-named demo project (R4.4).
const TEST = "https://axcgcjpmcdujxkvroqox.supabase.co";
const OWN = "https://abcdefghijklmnopqrst.supabase.co";

describe("judge seed target guard", () => {
  it("accepts loopback and the pinned kleeno-test project only with its ref", () => {
    expect(() => assertDemoLocation("http://127.0.0.1:54321", undefined, {})).not.toThrow();
    expect(() => assertDemoLocation(TEST, undefined, { SUPABASE_TEST_PROJECT_REF: "axcgcjpmcdujxkvroqox" })).not.toThrow();
    expect(() => assertDemoLocation(TEST, undefined, {})).toThrow("designated");
  });
  it("refuses unknown hosts, empty or malformed URLs and the production origin", () => {
    for (const url of ["https://remote.example", "", "not a url", "https://xyzxyzxyzxyzxyzxyzxy.supabase.co"]) expect(() => assertDemoLocation(url, undefined, {})).toThrow("designated");
    expect(() => assertDemoLocation(TEST, `${TEST}/`, { SUPABASE_TEST_PROJECT_REF: "axcgcjpmcdujxkvroqox" })).toThrow("designated");
    expect(() => assertDemoLocation("http://127.0.0.1:54321", "http://127.0.0.1:54321", {})).toThrow("designated");
    expect(() => assertDemoLocation("http://127.0.0.1:54321", "garbage", {})).toThrow("designated");
  });
  it("allows the owner's demo project only when SEED_JUDGE_TARGET_REF names exactly that https project and it is not production", () => {
    expect(() => assertDemoLocation(OWN, undefined, { SEED_JUDGE_TARGET_REF: "abcdefghijklmnopqrst" })).not.toThrow();
    expect(() => assertDemoLocation(OWN, undefined, { SEED_JUDGE_TARGET_REF: "zzzzzzzzzzzzzzzzzzzz" })).toThrow("designated");
    expect(() => assertDemoLocation(OWN, OWN, { SEED_JUDGE_TARGET_REF: "abcdefghijklmnopqrst" })).toThrow("designated");
    expect(() => assertDemoLocation("http://abcdefghijklmnopqrst.supabase.co", undefined, { SEED_JUDGE_TARGET_REF: "abcdefghijklmnopqrst" })).toThrow("designated");
    expect(() => assertDemoLocation("https://abcdefghijklmnopqrst.evil.example", undefined, { SEED_JUDGE_TARGET_REF: "abcdefghijklmnopqrst" })).toThrow("designated");
    expect(() => assertDemoLocation("https://x.supabase.co", undefined, { SEED_JUDGE_TARGET_REF: "x" })).toThrow("designated");
  });
});

describe("judge company and credentials", () => {
  it("accepts only a demo, non-sandbox company with live payments off", () => {
    const ok = { is_demo: true, is_sandbox: false, live_payments_enabled: false };
    expect(() => assertJudgeCompany(ok)).not.toThrow();
    for (const c of [{ ...ok, is_demo: false }, { ...ok, live_payments_enabled: true }, { ...ok, is_sandbox: true }]) expect(() => assertJudgeCompany(c)).toThrow();
  });
  it("refuses a wrong target before loading server code, and never echoes the password", async () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "invalid-before-server-import");
    try {
      await expect(seedJudge({ SUPABASE_URL: "https://remote.example", JUDGE_EMAIL: "j@example.com", JUDGE_PASSWORD: "secret-password-123" })).rejects.toThrow("designated");
      const missing = seedJudge({ SUPABASE_URL: "http://127.0.0.1:54321", JUDGE_EMAIL: "j@example.com" });
      await expect(missing).rejects.toThrow("JUDGE_PASSWORD");
      const short = await seedJudge({ SUPABASE_URL: "http://127.0.0.1:54321", JUDGE_EMAIL: "j@example.com", JUDGE_PASSWORD: "short-pw" }).catch((e: Error) => e.message);
      expect(short).toMatch(/12/);
      expect(short).not.toContain("short-pw");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
