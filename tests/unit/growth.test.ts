// W (docs/phases/W.md): validation (S53, S54), honest metrics (S58), formula-safe CSV (S56).
import { describe, expect, it } from "vitest";
import { JoinBody, SurveyBody, csvCell, leadMetrics, normalizeEmail, toCsv, type LeadRow } from "@/core/growth";

const ok = { email: "a@b.co", consent: true, elapsedMs: 4000 };

describe("sign-up validation", () => {
  it("trims and lower-cases emails for duplicate detection", () => {
    expect(normalizeEmail("  Jane.Doe+x@Example.COM ")).toBe("jane.doe+x@example.com");
  });
  it("accepts email-only and combined bodies", () => {
    expect(JoinBody.safeParse(ok).success).toBe(true);
    expect(JoinBody.safeParse({ ...ok, painPoint: "RECONCILIATION", budgetBand: "500_PLUS", wantsCall: true, role: "ACCOUNTING_AGENCY", companySize: "11_50" }).success).toBe(true);
  });
  it("rejects bad emails, missing consent, unknown enums and forged fields", () => {
    for (const bad of [
      { ...ok, email: "nope" },
      { ...ok, email: `${"a".repeat(250)}@b.co` },
      { ...ok, consent: false },
      { email: "a@b.co", elapsedMs: 1 },
      { ...ok, painPoint: "TAXES" },
      { ...ok, budgetBand: "1000" },
      { ...ok, status: "QUALIFIED" },
      { ...ok, isTest: true },
      { ...ok, utmSource: "<script>" },
    ])
      expect(JoinBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("survey needs a 43-character token and known answers", () => {
    const token = "A".repeat(43);
    expect(SurveyBody.safeParse({ token, wantsCall: false }).success).toBe(true);
    expect(SurveyBody.safeParse({ token: "short", wantsCall: false }).success).toBe(false);
    expect(SurveyBody.safeParse({ token, painPoint: "X" }).success).toBe(false);
    expect(SurveyBody.safeParse({ token, contactId: "x" }).success).toBe(false);
  });
});

const row = (r: Partial<LeadRow> = {}): LeadRow => ({ status: "NEW", is_test: false, role: null, source: null, utm_source: null, surveys: null, ...r });

describe("lead metrics", () => {
  it("empty data -> zeros and null rates, never a made-up number", () => {
    const m = leadMetrics([]);
    expect(m).toMatchObject({ signups: 0, surveyed: 0, surveyRate: null, wantsCall: 0, wantsCallRate: null, callToPilot: null });
    expect(Object.values(m.budgets).every((n) => n === 0)).toBe(true);
  });
  it("counts real records only, with the stated denominators", () => {
    const m = leadMetrics([
      row({ surveys: { pain_point: "RECONCILIATION", budget_band: "100_299", wants_call: true }, utm_source: "linkedin" }),
      row({ surveys: { pain_point: "RECONCILIATION", budget_band: null, wants_call: false }, source: "google.com" }),
      row({ status: "CALL_DONE" }),
      row({ status: "PILOT_CANDIDATE", role: "FINANCE" }),
      row({ is_test: true, status: "PILOT_CANDIDATE", surveys: { pain_point: "OTHER", budget_band: "500_PLUS", wants_call: true } }),
    ]);
    expect(m.signups).toBe(4);
    expect(m.surveyed).toBe(2);
    expect(m.surveyRate).toBe(0.5);
    expect(m.wantsCall).toBe(1);
    expect(m.wantsCallRate).toBe(0.25);
    expect(m.callToPilot).toBe(0.5); // 1 pilot ÷ (1 call done + 1 pilot)
    expect(m.pains.RECONCILIATION).toBe(2);
    expect(m.pains.OTHER).toBe(0); // the test record is excluded
    expect(m.budgets["500_PLUS"]).toBe(0);
    expect(m.budgets["100_299"]).toBe(1);
    expect(m.roles.FINANCE).toBe(1);
    expect(m.sources).toEqual([["direct", 2], ["linkedin", 1], ["google.com", 1]]);
  });
});

describe("CSV export", () => {
  it("neutralises formula starters and quotes every cell", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    for (const s of ["+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).startsWith(`"'`)).toBe(true);
    expect(csvCell('say "hi", ok')).toBe(`"say ""hi"", ok"`);
    expect(csvCell(null)).toBe(`""`);
    expect(csvCell("plain")).toBe(`"plain"`);
  });
  it("builds CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, "=x"]])).toBe(`"a","b"\r\n"1","'=x"\r\n`);
  });
});
