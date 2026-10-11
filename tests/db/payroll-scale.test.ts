// R3.1b: a realistic month-sized import (50 workers x 21 days = 1,050 timesheet rows, above PostgREST's 1,000-row cap)
// goes through import, reconcile and calculate with exact counts and no dropped rows (rule 14).
import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import type { AiProvider } from "@/core/ai";
import { parseUsdc } from "@/core/money";
import { openJson } from "@/server/crypto";
import { calculateRun } from "@/server/db/calculate";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { loadInput, loadRun, matchSummary, reconcileRun } from "@/server/db/reconciliation";
import { createWorker, listWorkers } from "@/server/db/workers";
import { admin, makeCompany, type TestCompany } from "./helpers";

const WORKERS = 50, DAYS = 21, ROWS = WORKERS * DAYS;
const noAdvice: AiProvider = { name: "fake", complete: async () => { throw new Error("off"); } };
let c: TestCompany, runId: string;
const who = () => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
const date = (i: number) => new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10); // 2026-10-05 .. 2026-10-25
const code = (n: number) => `W${String(n).padStart(3, "0")}`;

beforeAll(async () => {
  c = await makeCompany();
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "400", overtimeMultiplier: "1.5", hourlyCapHours: "400", aboveCapMultiplier: "1.5", deductions: [{ code: "TAX", label: "Tax", percent: "10" }], varianceTolerance: "0.01", rules: [{ ruleId: "PERCENT_DEDUCTION" as const, clauseIds: ["C1"] }] };
  const draft = await createConfigDraft(who(), { params, clauses: [{ id: "C1", text: "tax is 10%" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(who(), draft.id, act);
  for (let from = 0; from < WORKERS; from += 10) // small batches: the hosted database is slow
    await Promise.all(Array.from({ length: 10 }, (_, k) => createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: code(from + k + 1), payType: "HOURLY", compensation: { baseAmount: parseUsdc("0"), hourlyRate: parseUsdc("20") } })));
  runId = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: date(0), period_end: date(DAYS - 1), config_version: draft.version, created_by: c.payroll.id }).select("id").single()).data!.id as string;
});

it("imports, reconciles and calculates 50 workers x 21 days with exact counts", async () => {
  const items = Array.from({ length: ROWS }, (_, i) => ({ row: i + 2, data: { workerRef: code((i % WORKERS) + 1), date: date(Math.floor(i / WORKERS)), hours: "8" } }));
  const imported = await importRows(who(), { runId, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items });
  expect(imported).toMatchObject({ rows: ROWS, accepted: ROWS, newRecords: ROWS, rejected: [] });
  expect((await admin.from("timesheets").select("id", { count: "exact", head: true }).eq("run_id", runId)).count).toBe(ROWS);

  expect(await listWorkers(admin as never, c.id)).toHaveLength(WORKERS);
  const input = await loadInput(c.id, await loadRun(c.id, runId));
  expect(input.workers).toHaveLength(WORKERS);
  expect(input.timesheets).toHaveLength(ROWS);
  expect(new Set(input.timesheets.map((t) => t.id)).size).toBe(ROWS);
  expect(input.timesheets.every((t, i) => i === 0 || t.seq > input.timesheets[i - 1].seq)).toBe(true);

  const r = await reconcileRun(who(), runId, noAdvice);
  expect(r).toMatchObject({ status: "READY_FOR_CALCULATION", open: 0 });
  expect((await admin.from("exceptions").select("id", { count: "exact", head: true }).eq("run_id", runId)).count).toBe(0);
  expect(await matchSummary(admin as never, c.id, runId)).toMatchObject({ total: ROWS, autoMatched: ROWS, needReview: 0 });

  const calc = await calculateRun(who(), runId);
  expect(calc).toMatchObject({ status: "CALCULATION_VALIDATED", workers: WORKERS });
  const lines = (await admin.from("calculation_lines").select("worker_id, net").eq("calculation_id", calc.calculationId)).data!;
  expect(lines).toHaveLength(WORKERS);
  expect(new Set(lines.map((l) => l.net)).size).toBe(1); // identical hours and rate: identical net for all 50
  const row = (await admin.from("calculations").select("id, snapshot_enc").eq("run_id", runId).single()).data!;
  const snap = await openJson<{ evidence: Record<string, { id: string }[]> }>(c.id, "calculations", "snapshot_enc", row.id, row.snapshot_enc);
  expect(snap.evidence.timesheets).toHaveLength(ROWS);
  expect(new Set(snap.evidence.timesheets.map((e) => e.id)).size).toBe(ROWS);
});
