// Synthetic SIMULATION only. Reuses the protected six-worker cast; never creates credentials or wallets.
import { randomUUID } from "node:crypto";
import type { ConfigParams } from "../src/core/config";
import { createRun, type Role } from "../src/core/workflow";
import { parseUsdc } from "../src/core/money";
import { WorkerMetadataSchema } from "../src/core/workers";
import { demo, PERIOD } from "../tests/fixtures/reconciliation/demo";

const TEST_REF = "axcgcjpmcdujxkvroqox"; // the one hosted disposable project, never dev or prod

/** Loopback, the pinned kleeno-test project, or the owner's demo project named by SEED_JUDGE_TARGET_REF; never the production origin. */
export function assertDemoLocation(url: string, production: string | undefined, env: Record<string, string | undefined> = process.env) {
  const u = URL.canParse(url) ? new URL(url) : null;
  const host = u?.hostname ?? "";
  const ref = env.SEED_JUDGE_TARGET_REF;
  const pinnedTest = host === `${TEST_REF}.supabase.co` && env.SUPABASE_TEST_PROJECT_REF === TEST_REF;
  const optIn = !!ref && /^[a-z0-9]{20}$/.test(ref) && u?.protocol === "https:" && host === `${ref}.supabase.co`; // R4.4 owner demo deploy: explicit opt-in, exact project ref, https only
  const prod = !!production && (!URL.canParse(production) || new URL(production).origin === u?.origin);
  if (!u || prod || !(["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || pinnedTest || optIn)) {
    throw new Error("seed requires a designated local demo company with live payments off");
  }
}

export function assertDemoTarget(url: string, production: string | undefined, company: { is_demo: boolean; live_payments_enabled: boolean }) {
  assertDemoLocation(url, production);
  if (!company.is_demo || company.live_payments_enabled) {
    throw new Error("seed requires a designated local demo company with live payments off");
  }
}

export async function seedSimulationDemo(companyId: string, userId: string) {
  assertDemoLocation(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PROD_URL);
  const { db, must } = await import("../src/server/db/client");
  const { configAction, createConfigDraft, loadConfig } = await import("../src/server/db/configs");
  const { createWorker, listWorkers } = await import("../src/server/db/workers");
  const { importRows } = await import("../src/server/db/imports");
  const { reconcileRun } = await import("../src/server/db/reconciliation");
  const { runDeps } = await import("../src/server/db/runs");
  const company = must(await db().from("companies").select("is_demo, live_payments_enabled").eq("id", companyId).single(), "demo company");
  assertDemoTarget(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PROD_URL, company);
  const member = must(await db().from("memberships").select("roles").eq("company_id", companyId).eq("user_id", userId).is("removed_at", null).single(), "demo actor");
  if (!member.roles.includes("OWNER") || !member.roles.includes("PAYROLL_APPROVER")) throw new Error("demo actor must be its Owner and payroll approver");
  const who = () => ({ companyId, userId, roles: member.roles as Role[], correlationId: randomUUID() });
  const fixture = demo();
  const policy = "Synthetic demo: 40 scheduled hours; overtime above 40 hours at 1.5 times, salaried workers receive base pay.";
  const params: ConfigParams = { ...fixture.config, overtimeMultiplier: "1.5", aboveCapMultiplier: "1.5", deductions: [], varianceTolerance: "0.01", rules: [{ ruleId: "BASE_SALARY", clauseIds: ["C1"] }] };
  const configRead = await db().from("payroll_configurations").select("id, version, status").eq("company_id", companyId).eq("status", "ACTIVE").maybeSingle();
  if (configRead.error) throw new Error("demo active configuration read failed");
  let config = configRead.data;
  if (!config) {
    const draft = await createConfigDraft(who(), { params, clauses: [{ id: "C1", text: policy }] });
    for (const action of ["validate", "request_review", "approve", "activate"]) await configAction(who(), draft.id, action);
    config = { ...draft, status: "ACTIVE" };
  }
  const loaded = await loadConfig(companyId, config.version);
  const configValues = loaded?.config as unknown as Record<string, unknown> | undefined;
  if (loaded?.clauses.length !== 1 || loaded.clauses[0].text !== policy || Object.entries(params).some(([key, value]) => JSON.stringify(configValues?.[key]) !== JSON.stringify(value)) || loaded.config.scopedRules?.length) throw new Error("dedicated demo configuration differs from the fixture");
  const existing = await listWorkers(db(), companyId);
  const expectedMetadata = WorkerMetadataSchema.parse({});
  for (const w of existing) {
    const expected = fixture.workers.find(f => f.id === w.pseudonym);
    if (!expected || expected.payType !== w.payType || !w.active || Object.entries(expectedMetadata).some(([key, value]) => JSON.stringify(w.metadata[key as keyof typeof expectedMetadata]) !== JSON.stringify(value)) || w.compensation?.baseAmount !== parseUsdc(w.payType === "HOURLY" ? "0" : "1000") || w.compensation?.hourlyRate !== parseUsdc(w.payType === "HOURLY" ? "20" : "0")) throw new Error("dedicated demo workforce differs from the fixture");
  }
  for (const w of fixture.workers) if (!existing.some(e => e.pseudonym === w.id)) {
    await createWorker(who(), { pseudonym: w.id, payType: w.payType, compensation: { baseAmount: parseUsdc(w.payType === "HOURLY" ? "0" : "1000"), hourlyRate: parseUsdc(w.payType === "HOURLY" ? "20" : "0") } });
  }
  const runs = must(await db().from("payroll_runs").select("id, status, mode").eq("company_id", companyId).eq("period_start", PERIOD.start).eq("period_end", PERIOD.end), "demo runs");
  if (runs.length > 1 || runs.some(r => r.mode !== "SIMULATION")) throw new Error("demo period is ambiguous; use a dedicated demo company");
  const run = runs[0] ?? { ...(await createRun(runDeps, who(), { mode: "SIMULATION", periodStart: PERIOD.start, periodEnd: PERIOD.end })), status: "DRAFT" };
  if (["DRAFT", "DATA_IMPORTED"].includes(run.status)) {
    await importRows(who(), { runId: run.id, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2, approvedExtraHours: 3 }, items: fixture.timesheets.map((t, i) => ({ row: i + 2, data: { workerRef: t.workerId, date: t.date, hours: t.hours, approvedExtraHours: t.approvedExtraHours } })) });
    await importRows(who(), { runId: run.id, type: "LEAVE", mapping: { workerRef: 0, date: 1, leaveType: 2, hours: 3 }, items: fixture.leave.map((l, i) => ({ row: i + 2, data: { workerRef: l.workerId, date: l.date, leaveType: l.leaveType, hours: l.hours } })) });
    run.status = (await reconcileRun(who(), run.id, { name: "synthetic-offline", complete: async () => { throw new Error("no provider calls in demo seed"); } })).status;
  }
  if (!["EXCEPTIONS_PENDING", "READY_FOR_CALCULATION", "CALCULATED", "CALCULATION_VALIDATED"].includes(run.status)) throw new Error("demo is in an unsupported partial state; inspect before resuming");
  return { companyId, runId: run.id, mode: "SIMULATION" as const, status: run.status };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/seed-demo.ts")) {
  const companyId = process.env.DEMO_COMPANY_ID;
  const userId = process.env.DEMO_OWNER_ID;
  if (!companyId || !userId) throw new Error("set DEMO_COMPANY_ID and DEMO_OWNER_ID for a dedicated demo");
  seedSimulationDemo(companyId, userId).then(result => console.log(JSON.stringify(result))).catch(() => { console.error("demo seed failed; inspect the designated demo state"); process.exitCode = 1; });
}
