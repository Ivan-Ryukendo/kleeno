import { beforeAll, describe, expect, it } from "vitest";
import { AiBudgetExhausted } from "@/core/ai/budget";
import { reserveCompanyAiTokens } from "@/server/db/ai-budget";
import { randomUUID } from "node:crypto";
import { proposeConfig } from "@/server/ai/policy";
import { openRouterProvider } from "@/server/ai/openrouter";
import { GOOD, POLICY_TEXT } from "../fixtures/ai/policy";
import { admin, asOwner, makeCompany, userClient, type TestCompany } from "./helpers";

let company: TestCompany;
beforeAll(async () => { company = await makeCompany(); });
describe("R6.4 atomic company UTC AI budget", () => {
  it("allows exactly four concurrent 50000 reservations, refuses further charges and isolates companies", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => admin.rpc("reserve_ai_tokens", { p_company_id: company.id, p_tokens: 50000 })));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.filter((r) => r.data !== null).map((r) => r.data).sort((a, b) => a - b)).toEqual([50000, 100000, 150000, 200000]);
    await expect(reserveCompanyAiTokens(company.id, 1)).rejects.toBeInstanceOf(AiBudgetExhausted);
    const other = await makeCompany();
    await expect(reserveCompanyAiTokens(other.id, 1)).resolves.toBeUndefined();
    const row = await asOwner("select reserved_tokens,budget_day::text from private.ai_daily_token_budgets where company_id=$1", [company.id]);
    expect(row.rows[0].reserved_tokens).toBe(200000);
    const day = await asOwner("select (statement_timestamp() at time zone 'UTC')::date::text as day");
    expect(row.rows[0].budget_day).toBe(day.rows[0].day);
  });
  it("validates charges in SQL and repository without leaking provider text", async () => {
    for (const tokens of [null, -1, 0, 200001]) {
      expect((await admin.rpc("reserve_ai_tokens", { p_company_id: company.id, p_tokens: tokens })).error?.code).toBe("22023");
    }
    await expect(reserveCompanyAiTokens("invalid-company", 1)).rejects.toThrow();
    await expect(reserveCompanyAiTokens(company.id, -1)).rejects.toThrow();
  });
  it("blocks user reads/reservations and direct service counter mutation", async () => {
    const user = await userClient(company.payroll, company.id);
    expect((await user.rpc("reserve_ai_tokens", { p_company_id: company.id, p_tokens: 1 })).error).not.toBeNull();
    expect((await user.from("ai_daily_token_budgets").select("*")).error).not.toBeNull();
    expect((await admin.from("ai_daily_token_budgets").update({ reserved_tokens: 0 }).eq("company_id", company.id)).error).not.toBeNull();
    expect((await admin.from("ai_daily_token_budgets").delete().eq("company_id", company.id)).error).not.toBeNull();
    expect((await admin.from("ai_daily_token_budgets").insert({ company_id: company.id, budget_day: "2000-01-01", reserved_tokens: 0 })).error).not.toBeNull();
    const access = await asOwner("select role, has_schema_privilege(role, 'private', 'USAGE') as usage, has_table_privilege(role, 'private.ai_daily_token_budgets', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as direct from unnest(array['anon','authenticated','service_role']) as role");
    expect(access.rows).toEqual(['anon','authenticated','service_role'].map((role) => ({ role, usage: false, direct: false })));
    const catalog = await asOwner("select relrowsecurity, to_regclass('public.ai_daily_token_budgets') as exposed from pg_class where oid='private.ai_daily_token_budgets'::regclass");
    expect(catalog.rows).toEqual([{ relrowsecurity: true, exposed: null }]);
  });
  it("starts a new UTC day without refunding or altering historical reservations", async () => {
    const c = await makeCompany();
    await asOwner("insert into private.ai_daily_token_budgets(company_id,budget_day,reserved_tokens) values($1,(statement_timestamp() at time zone 'UTC')::date-1,200000)", [c.id]);
    await reserveCompanyAiTokens(c.id, 10);
    const rows = await asOwner("select reserved_tokens from private.ai_daily_token_budgets where company_id=$1 order by budget_day", [c.id]);
    expect(rows.rows.map((r) => r.reserved_tokens)).toEqual([200000, 10]);
  });
  it("records counters/model pins without raw input and charges cache hits zero", async () => {
    const c = await makeCompany();
    const who = () => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
    let calls = 0;
    const provider = () => openRouterProvider({ apiKey: "synthetic", models: ["m1"],
      reserve: (tokens) => reserveCompanyAiTokens(c.id, tokens),
      fetchFn: async () => { calls++; return new Response(JSON.stringify({ model: "m1", choices: [{ message: { content: JSON.stringify(GOOD) } }] })); },
    });
    const first = await proposeConfig(who(), POLICY_TEXT, provider());
    const second = await proposeConfig(who(), POLICY_TEXT, provider());
    expect(first.status).toBe("ACCEPTED");
    expect(second.cacheHit).toBe(true);
    expect(calls).toBe(1);
    const executions = await admin.from("ai_executions").select("id,validation").in("id", [first.executionId, second.executionId]);
    const firstTelemetry = executions.data?.find((e) => e.id === first.executionId)?.validation.telemetry;
    const cachedTelemetry = executions.data?.find((e) => e.id === second.executionId)?.validation.telemetry;
    expect(firstTelemetry).toMatchObject({ version: "ai-bound-v1", attempts: 1, budgetEnforced: true, pinnedModels: ["m1"] });
    expect(cachedTelemetry).toMatchObject({ attempts: 0, reservedTokens: 0 });
    const budget = await asOwner("select reserved_tokens from private.ai_daily_token_budgets where company_id=$1", [c.id]);
    expect(budget.rows[0].reserved_tokens).toBe(firstTelemetry.reservedTokens);
    expect(JSON.stringify(executions.data)).not.toContain("Full-time staff");
    expect(JSON.stringify(executions.data)).not.toContain("synthetic");
  });
});
