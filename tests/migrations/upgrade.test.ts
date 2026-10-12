import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertMigrationUpgradeTarget } from "../../scripts/migration-upgrade-target";
import { openField, openJson, sealField } from "@/server/crypto";
import { listExceptions } from "@/server/db/reconciliation";
import { createWorker, listWorkers } from "@/server/db/workers";
import { activeConfig, admin, asOwner, makeCompany } from "../db/helpers";

function migrate(args: string[]) {
  assertMigrationUpgradeTarget(process.env);
  // Explicit --local ignores any linked remote project; never replay non-idempotent SQL directly.
  execFileSync("supabase", args, { stdio: "pipe", timeout: 120_000 });
}
async function history() {
  return (await asOwner("select version,name from supabase_migrations.schema_migrations order by version")).rows;
}
async function rows(table: string, company: string) {
  const result = await admin.from(table).select("*").eq("company_id", company).order(table === "memberships" ? "user_id" : "id");
  expect(result.error).toBeNull();
  return result.data!;
}

it("upgrades populated October 8 payroll records without rewriting encrypted data or prior audit", async () => {
  migrate(["db", "reset", "--local", "--version", "20261008000007", "--no-seed"]);
  expect((await history()).at(-1)?.version).toBe("20261008000007");
  const company = await makeCompany(), cfg = await activeConfig(company);
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const worker = await createWorker(who, { pseudonym: "W001", payType: "SALARIED", compensation: { baseAmount: 123450000n, hourlyRate: 0n } });
  const run = await admin.from("payroll_runs").insert({ company_id: company.id, mode: "SIMULATION", config_version: cfg.version, period_start: "2026-10-01", period_end: "2026-10-31", created_by: who.userId }).select("id").single();
  expect(run.error).toBeNull();
  const exception = await admin.from("exceptions").insert({ company_id: company.id, run_id: run.data!.id, worker_id: worker.id, category: "DUPLICATE_TIMESHEET", severity: "HIGH", dedupe_key: "migration-check", options: ["KEEP_FIRST", "KEEP_LATEST"] }).select("id").single();
  expect(exception.error).toBeNull();
  const tables = ["memberships", "workers", "compensations", "payroll_configurations", "payroll_runs", "exceptions", "audit_events"];
  const before = await Promise.all(tables.map(table => rows(table, company.id)));
  migrate(["migration", "up", "--local"]);
  expect(await Promise.all(tables.map(table => rows(table, company.id)))).toEqual(before);
  const migrations = await history();
  expect(migrations.map(row => row.version)).toEqual(readdirSync("supabase/migrations").filter(file => file.endsWith(".sql")).sort().map(file => file.slice(0, 14)));
  const loaded = await listWorkers(admin, company.id);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({ id: worker.id, pseudonym: "W001", compensation: { baseAmount: 123450000n, hourlyRate: 0n } });
  const configuration = before[tables.indexOf("payroll_configurations")][0];
  expect(await openJson(company.id, "payroll_configurations", "clauses_enc", configuration.id, configuration.clauses_enc)).toEqual([{ id: "C1", text: "CANARY-CLAUSE-policy-text-7788" }]);
  const id = exception.data!.id, note = "Synthetic migrated exception decision";
  const command = { p_company: company.id, p_id: id, p_actor: who.userId, p_correlation: who.correlationId, p_action: "KEEP_FIRST", p_resolution: await sealField(company.id, "exceptions", "resolution", id, note) };
  const resolution = await admin.rpc("resolve_reconciliation_exception", command);
  expect(resolution.error).toBeNull(); expect(resolution.data).toBe("OK");
  const stored = (await rows("exceptions", company.id))[0];
  expect(stored).toMatchObject({ id, run_id: run.data!.id, worker_id: worker.id, status: "RESOLVED", resolution_action: "KEEP_FIRST", resolved_by: who.userId });
  expect(await openField(company.id, "exceptions", "resolution", id, stored.resolution)).toBe(note);
  expect((await listExceptions(admin, company.id, run.data!.id))[0]).toMatchObject({ id, note, decision: "KEEP_FIRST" });
  const audit = await rows("audit_events", company.id);
  expect(audit.filter(row => row.event === "exception.resolve")).toHaveLength(1);
  expect(audit.filter(row => row.event === "exception.resolve")[0]).toMatchObject({ entity_id: id, correlation_id: who.correlationId, refs: { action: "KEEP_FIRST", runId: run.data!.id } });
  for (const prior of before[tables.indexOf("audit_events")]) expect(audit).toContainEqual(prior);
  const after = await Promise.all(tables.map(table => rows(table, company.id)));
  migrate(["migration", "up", "--local"]);
  expect(await history()).toEqual(migrations);
  expect(await Promise.all(tables.map(table => rows(table, company.id)))).toEqual(after);
  const replay = await admin.rpc("resolve_reconciliation_exception", command);
  expect(replay.error).toBeNull(); expect(replay.data).toBe("STALE_STATE");
  expect(await rows("audit_events", company.id)).toEqual(audit);
});

it("moves populated AI budgets into the private schema without resetting their counters", async () => {
  migrate(["db", "reset", "--local", "--version", "20261011000004", "--no-seed"]);
  const company = await makeCompany();
  const reservation = await admin.rpc("reserve_ai_tokens", { p_company_id: company.id, p_tokens: 123 });
  expect(reservation.error).toBeNull(); expect(reservation.data).toBe(123);
  const before = (await asOwner("select * from public.ai_daily_token_budgets where company_id=$1", [company.id])).rows;
  expect(before).toHaveLength(1);
  migrate(["migration", "up", "--local"]);
  expect((await asOwner("select * from private.ai_daily_token_budgets where company_id=$1", [company.id])).rows).toEqual(before);
  expect((await asOwner("select to_regclass('public.ai_daily_token_budgets') as table_name")).rows[0].table_name).toBeNull();
  const next = await admin.rpc("reserve_ai_tokens", { p_company_id: company.id, p_tokens: 1 });
  expect(next.error).toBeNull(); expect(next.data).toBe(124);
  const historyBefore = await history(), dataBefore = (await asOwner("select * from private.ai_daily_token_budgets where company_id=$1", [company.id])).rows;
  migrate(["migration", "up", "--local"]);
  expect(await history()).toEqual(historyBefore);
  expect((await asOwner("select * from private.ai_daily_token_budgets where company_id=$1", [company.id])).rows).toEqual(dataBefore);
});
