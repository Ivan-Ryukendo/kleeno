import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRun } from "@/core/workflow";
import { assertLive } from "@/server/db/batches";
import { requestLive, switchLive } from "@/server/db/live-payments";
import { runDeps } from "@/server/db/runs";
import { seedJudge } from "../../scripts/seed-judge";
import { admin, makeCompany, uniq, userClient } from "./helpers";

// R4.3 on a disposable target (pinned kleeno-test or loopback): unique names per run, everything created is deleted afterwards.
const companies: string[] = [];
const users: string[] = [];
afterAll(async () => {
  for (const id of companies) await admin.rpc("delete_company", { p_company: id });
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

const judge = { email: `judge-${uniq()}@example.com`, password: `pw-${randomUUID()}`, name: `judge-test-${uniq()}` };
const env = (over: Record<string, string | undefined> = {}) => ({ ...process.env, JUDGE_EMAIL: judge.email, JUDGE_PASSWORD: judge.password, JUDGE_COMPANY_NAME: judge.name, ...over });

async function snapshot(companyId: string, runId: string) {
  const rows = async (q: PromiseLike<{ data: unknown; error: unknown }>) => { const r = await q; expect(r.error).toBeNull(); return r.data; };
  return {
    company: await rows(admin.from("companies").select("*").eq("id", companyId).single()),
    members: await rows(admin.from("memberships").select("user_id, roles, removed_at").eq("company_id", companyId).order("user_id")),
    workers: await rows(admin.from("workers").select("id, pseudonym").eq("company_id", companyId).order("id")),
    runs: await rows(admin.from("payroll_runs").select("id, mode, status").eq("company_id", companyId).order("id")),
    configs: await rows(admin.from("payroll_configurations").select("id, version, status").eq("company_id", companyId).order("id")),
    imports: await rows(admin.from("import_batches").select("id").eq("run_id", runId).order("id")),
    exceptions: await rows(admin.from("exceptions").select("id").eq("run_id", runId).order("id")),
    audit: (await admin.from("audit_events").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count,
  };
}

describe("seed-judge", () => {
  let seeded: Awaited<ReturnType<typeof seedJudge>> | undefined;

  it("creates the SIMULATION judge company once; a second run changes nothing", async () => {
    const first = await seedJudge(env());
    seeded = first;
    companies.push(first.companyId);
    users.push(first.userId);
    expect(first).toMatchObject({ mode: "SIMULATION", status: "EXCEPTIONS_PENDING", created: { company: true, user: true, membership: true } });
    expect(JSON.stringify(first)).not.toContain(judge.password);
    expect(JSON.stringify(first)).not.toContain(judge.email);
    const company = (await admin.from("companies").select("is_demo, is_sandbox, live_payments_enabled, live_status, mfa_required, onboarded_at").eq("id", first.companyId).single()).data!;
    expect(company).toMatchObject({ is_demo: true, is_sandbox: false, live_payments_enabled: false, live_status: "NOT_REQUESTED", mfa_required: false });
    expect(company.onboarded_at).not.toBeNull();
    const before = await snapshot(first.companyId, first.runId);
    expect(before.members).toEqual([{ user_id: first.userId, roles: ["OWNER", "PAYROLL_APPROVER"], removed_at: null }]);
    expect(before.workers).toHaveLength(6);
    expect(before.runs).toEqual([{ id: first.runId, mode: "SIMULATION", status: "EXCEPTIONS_PENDING" }]);

    const second = await seedJudge(env());
    expect(second).toEqual({ ...first, created: { company: false, user: false, membership: false } });
    expect(await snapshot(first.companyId, first.runId)).toEqual(before);
    await userClient({ id: first.userId, email: judge.email, password: judge.password, roles: ["OWNER", "PAYROLL_APPROVER"], companyId: first.companyId }); // the owner-supplied login works

    // MFA switched on by mistake is turned off again, only on this demo company, with nothing else touched.
    expect((await admin.from("companies").update({ mfa_required: true }).eq("id", first.companyId)).error).toBeNull();
    expect(await seedJudge(env())).toEqual(second);
    expect((await admin.from("companies").select("mfa_required").eq("id", first.companyId).single()).data?.mfa_required).toBe(false);
  });

  it("denies every live payment path for the judge company", async () => {
    const s = seeded!;
    const who = { companyId: s.companyId, userId: s.userId, roles: ["OWNER", "PAYROLL_APPROVER"] as const, correlationId: randomUUID() };
    expect((await admin.from("companies").update({ live_payments_enabled: true }).eq("id", s.companyId)).error?.code).toBe("23514"); // DB CHECK: no live for demo
    expect((await admin.from("companies").update({ live_status: "REQUESTED" }).eq("id", s.companyId)).error?.code).toBe("23514");
    await expect(requestLive(who)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(switchLive(who, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertLive(s.companyId)).rejects.toMatchObject({ code: "LIVE_PAYMENTS_DISABLED" }); // the payment gate's kill-switch check
    await expect(createRun(runDeps, { ...who, roles: [...who.roles] }, { mode: "LIVE_TESTNET", periodStart: "2031-01-01", periodEnd: "2031-01-14" })).rejects.toMatchObject({ code: "LIVE_PAYMENTS_DISABLED" });
    expect((await admin.from("payroll_runs").select("id").eq("company_id", s.companyId).eq("mode", "LIVE_TESTNET")).data).toEqual([]);
    expect((await admin.from("obligations").select("id").eq("company_id", s.companyId)).data).toEqual([]);
    expect((await admin.from("companies").select("live_payments_enabled").eq("id", s.companyId).single()).data?.live_payments_enabled).toBe(false);
  });

  it("refuses a non-demo or live company, a wrong or production host, and a login that belongs to a real company", async () => {
    const real = await makeCompany();
    const live = await makeCompany({ live: true });
    companies.push(real.id, live.id);
    users.push(real.payroll.id, real.payment.id, live.payroll.id, live.payment.id);
    const nameOf = async (id: string) => (await admin.from("companies").select("name").eq("id", id).single()).data!.name as string;
    const fresh = `judge-${uniq()}@example.com`;
    for (const id of [real.id, live.id]) {
      await expect(seedJudge(env({ JUDGE_COMPANY_NAME: await nameOf(id), JUDGE_EMAIL: fresh }))).rejects.toThrow("demo company");
      expect((await admin.from("memberships").select("user_id").eq("company_id", id)).data).toHaveLength(2);
    }
    expect((await admin.from("memberships").select("user_id").eq("email", fresh)).data).toEqual([]);

    const otherName = `judge-test-${uniq()}`;
    await expect(seedJudge(env({ JUDGE_COMPANY_NAME: otherName, JUDGE_EMAIL: real.payroll.email }))).rejects.toThrow("non-demo");
    expect((await admin.from("companies").select("id").eq("name", otherName)).data).toEqual([]);

    await expect(seedJudge(env({ JUDGE_COMPANY_NAME: otherName, SUPABASE_URL: "https://remote.example" }))).rejects.toThrow("designated");
    await expect(seedJudge(env({ JUDGE_COMPANY_NAME: otherName, SUPABASE_PROD_URL: process.env.SUPABASE_URL }))).rejects.toThrow("designated");
    if (new URL(process.env.SUPABASE_URL!).hostname.endsWith(".supabase.co")) { // hosted kleeno-test: an opt-in for another ref does not unlock it
      await expect(seedJudge(env({ JUDGE_COMPANY_NAME: otherName, SUPABASE_TEST_PROJECT_REF: "", SEED_JUDGE_TARGET_REF: "zzzzzzzzzzzzzzzzzzzz" }))).rejects.toThrow("designated");
    }
    expect((await admin.from("companies").select("id").eq("name", otherName)).data).toEqual([]);
  });
});
