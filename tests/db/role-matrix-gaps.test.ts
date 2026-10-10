// R2.4/R2.5 role-matrix gaps: VIEWER direct writes refused, mid-session revocation of finance roles, concurrent calculation of one run.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AiProvider } from "@/core/ai";
import { parseUsdc } from "@/core/money";
import { calculateRun } from "@/server/db/calculate";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { reconcileRun } from "@/server/db/reconciliation";
import { createWorker } from "@/server/db/workers";
import { activeConfig, admin, makeCompany, pendingRun, userClient, type TestCompany, type TestUser } from "./helpers";

const noAdvice: AiProvider = { name: "fake", complete: async () => { throw new Error("off"); } };
const rawTables = ["calculation_lines", "workers"];

describe("R2.4 VIEWER cannot write through the public API", () => {
  let c: TestCompany, viewer: TestUser, workerId: string, runId: string;
  beforeAll(async () => {
    c = await makeCompany();
    const email = `viewer-writes-${randomUUID()}@example.com`, password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("viewer creation failed");
    viewer = { id: created.data.user.id, companyId: c.id, email, password, roles: ["VIEWER"] };
    expect((await admin.from("memberships").insert({ company_id: c.id, user_id: viewer.id, email, roles: viewer.roles })).error).toBeNull();
    const cfg = await activeConfig(c);
    workerId = (await createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: "W900", payType: "SALARIED", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: 0n } })).id;
    const run = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-31", config_version: cfg.config.version, created_by: c.payroll.id }).select("id").single();
    if (run.error) throw new Error("run insert failed");
    runId = run.data.id;
  });

  it("insert/update/delete on workers and payroll_runs are refused and nothing changes", async () => {
    const client = await userClient(viewer, c.id);
    const wBefore = (await admin.from("workers").select("*").eq("id", workerId).single()).data;
    const rBefore = (await admin.from("payroll_runs").select("*").eq("id", runId).single()).data;
    const workerCount = (await admin.from("workers").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count;
    const runCount = (await admin.from("payroll_runs").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count;

    const ins1 = await client.from("workers").insert({ company_id: c.id, pseudonym: "W901", pay_type: "SALARIED" }).select();
    expect(ins1.error, "workers insert").not.toBeNull();
    const ins2 = await client.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-11-01", period_end: "2026-11-30", config_version: 1, created_by: viewer.id }).select();
    expect(ins2.error, "payroll_runs insert").not.toBeNull();

    // update/delete may surface as an error or as zero affected rows; either way no row may come back and nothing may change.
    const upd1 = await client.from("workers").update({ pseudonym: "HACKED" }).eq("id", workerId).select();
    expect(upd1.error !== null || (upd1.data ?? []).length === 0, "workers update").toBe(true);
    const upd2 = await client.from("payroll_runs").update({ status: "APPROVED" }).eq("id", runId).select();
    expect(upd2.error !== null || (upd2.data ?? []).length === 0, "payroll_runs update").toBe(true);
    const del1 = await client.from("workers").delete().eq("id", workerId).select();
    expect(del1.error !== null || (del1.data ?? []).length === 0, "workers delete").toBe(true);
    const del2 = await client.from("payroll_runs").delete().eq("id", runId).select();
    expect(del2.error !== null || (del2.data ?? []).length === 0, "payroll_runs delete").toBe(true);

    expect((await admin.from("workers").select("*").eq("id", workerId).single()).data).toEqual(wBefore);
    expect((await admin.from("payroll_runs").select("*").eq("id", runId).single()).data).toEqual(rBefore);
    expect((await admin.from("workers").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count).toBe(workerCount);
    expect((await admin.from("payroll_runs").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count).toBe(runCount);
  });
});

describe("R2.4 revoked finance member loses raw reads on the already-issued session", () => {
  it("PAYMENT_APPROVER and PAYROLL_APPROVER removed mid-session immediately read nothing", async () => {
    const c = await makeCompany({ live: true });
    await pendingRun(c);
    const payment = await userClient(c.payment, c.id), payroll = await userClient(c.payroll, c.id);
    for (const [name, client] of [["payment", payment], ["payroll", payroll]] as const) {
      expect((await client.from("calculation_lines").select("net")).data?.length, `${name} before`).toBeGreaterThan(0);
      expect((await client.from("workers").select("wallet_address")).data?.length, `${name} workers before`).toBeGreaterThan(0);
    }
    // the company must keep an Owner, so add a second one before revoking the payroll member (who holds OWNER)
    const email = `second-owner-${randomUUID()}@example.com`;
    const owner = await admin.auth.admin.createUser({ email, password: `pw-${randomUUID()}`, email_confirm: true });
    if (owner.error || !owner.data.user) throw new Error("owner creation failed");
    expect((await admin.from("memberships").insert({ company_id: c.id, user_id: owner.data.user.id, email, roles: ["OWNER"] })).error).toBeNull();
    const removed = new Date().toISOString();
    for (const u of [c.payment, c.payroll]) expect((await admin.from("memberships").update({ removed_at: removed }).eq("company_id", c.id).eq("user_id", u.id)).error).toBeNull();
    for (const [name, client] of [["payment", payment], ["payroll", payroll]] as const) {
      for (const table of rawTables) {
        const r = await client.from(table).select("*");
        expect(r.error !== null || (r.data ?? []).length === 0, `${name} ${table} after revocation`).toBe(true);
        expect(r.data ?? [], `${name} ${table} rows`).toEqual([]);
      }
    }
  });
});

describe("R2.5 concurrent calculation of one run", () => {
  it("exactly one calculation row is committed; the other call is refused or returns the same result", async () => {
    const c = await makeCompany();
    const who = { companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles };
    const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [{ code: "TAX", label: "Tax", percent: "10" }], varianceTolerance: "0.01", rules: [{ ruleId: "PERCENT_DEDUCTION" as const, clauseIds: ["C1"] }] };
    const draft = await createConfigDraft({ ...who, correlationId: randomUUID() }, { params, clauses: [{ id: "C1", text: "tax is 10%" }] });
    for (const act of ["validate", "request_review", "approve", "activate"]) await configAction({ ...who, correlationId: randomUUID() }, draft.id, act);
    await createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: "W301", payType: "RETAINER", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: 0n } });
    const run = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: draft.version, created_by: c.payroll.id }).select("id").single()).data!.id as string;
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    await importRows({ ...who, correlationId: randomUUID() }, { runId: run, type: "TIMESHEETS", items: days.map((date, i) => ({ row: i + 2, data: { workerRef: "W301", date, hours: "8" } })), mapping: { workerRef: 0, date: 1, hours: 2 } });
    await reconcileRun({ ...who, correlationId: randomUUID() }, run, noAdvice);
    expect((await admin.from("payroll_runs").select("status").eq("id", run).single()).data!.status).toBe("READY_FOR_CALCULATION");

    const results = await Promise.allSettled([calculateRun({ ...who, correlationId: randomUUID() }, run), calculateRun({ ...who, correlationId: randomUUID() }, run)]);
    const rows = (await admin.from("calculations").select("id, calculation_hash").eq("run_id", run)).data!;
    expect(rows, "exactly one calculation row").toHaveLength(1);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof calculateRun>>> => r.status === "fulfilled");
    expect(fulfilled.length, `at least one call succeeds: ${results.map((r) => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "ok")).join(" | ")}`).toBeGreaterThanOrEqual(1);
    for (const f of fulfilled) expect(f.value.calculationId).toBe(rows[0].id);
    expect((await admin.from("calculation_lines").select("id").eq("calculation_id", rows[0].id)).data).toHaveLength(1);
  });
});
