import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { exceptionMachine, runMachine, TransitionError } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { analyse, OPTIONS, RECON_CATEGORIES, type ReconCategory, type ReconInput, type ResolutionAction } from "@/core/reconciliation";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import type { AiProvider } from "@/core/ai";
import { suggestForExceptions } from "@/server/ai/recon";
import { openField, sealField } from "@/server/crypto";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { loadConfig } from "./configs";
import { runStore } from "./runs";
import { dbStore } from "./store";
import { listWorkers } from "./workers";

const exceptionStore = dbStore<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" | "ESCALATED">("exceptions");
const OPEN_STATES = ["OPEN", "IN_REVIEW", "ESCALATED"];

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}
const need = (who: Who) => {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side reconciles and resolves");
  return who.correlationId ?? newCorrelationId();
};

export async function loadRun(companyId: string, runId: string) {
  const run = (await db().from("payroll_runs").select("id, status, config_version, period_start, period_end").eq("id", runId).eq("company_id", companyId).maybeSingle()).data;
  if (!run) throw new TransitionError("NOT_FOUND", "run not found");
  return run;
}

/** Evidence of one run as pure reconciliation input. Row order is import time, then CSV line, so "first" and "latest" are well defined. */
export async function loadInput(companyId: string, run: Awaited<ReturnType<typeof loadRun>>): Promise<ReconInput> {
  const cfg = await loadConfig(companyId, run.config_version);
  if (!cfg) throw new WorkflowError("NO_ACTIVE_CONFIG", "the run's configuration is missing");
  const q = (table: string, cols: string) => db().from(table).select(cols).eq("company_id", companyId).eq("run_id", run.id).order("created_at").order("source_line").order("occurrence");
  const sheets = must(await q("timesheets", "id, worker_id, work_date, hours, approved_extra_hours"), "timesheets read") as unknown as { id: string; worker_id: string; work_date: string; hours: number; approved_extra_hours: number }[];
  const leave = must(await q("leave_records", "id, worker_id, leave_date, leave_type, hours"), "leave read") as unknown as { id: string; worker_id: string; leave_date: string; leave_type: "PAID" | "UNPAID"; hours: number }[];
  const withEvidence = new Set([...sheets.map((s) => s.worker_id), ...leave.map((l) => l.worker_id)]);
  const workers = (await listWorkers(db(), companyId)).filter(w => w.active || withEvidence.has(w.id) || (w.metadata.employmentEnd && w.metadata.employmentEnd >= run.period_start && (!w.metadata.employmentStart || w.metadata.employmentStart <= run.period_end)));
  return {
    config: cfg.config,
    period: { start: run.period_start, end: run.period_end },
    workers: workers.map((w) => ({ id: w.id, pseudonym: w.pseudonym, payType: w.payType, ...w.metadata })),
    timesheets: sheets.map((s, i) => ({ id: s.id, workerId: s.worker_id, date: s.work_date, hours: String(s.hours), approvedExtraHours: String(s.approved_extra_hours), seq: i })),
    leave: leave.map((l, i) => ({ id: l.id, workerId: l.worker_id, date: l.leave_date, leaveType: l.leave_type, hours: String(l.hours), seq: i })),
  };
}

/** The decisions taken so far, by exception identity. */
export async function loadResolutions(companyId: string, runId: string) {
  const rows = must(await db().from("exceptions").select("dedupe_key, resolution_action").eq("company_id", companyId).eq("run_id", runId).eq("status", "RESOLVED").in("category", RECON_CATEGORIES), "resolutions read");
  return new Map(rows.filter((e) => e.resolution_action).map((e) => [e.dedupe_key as string, e.resolution_action as ResolutionAction]));
}

/**
 * Re-runs the deterministic checks with the decisions taken so far, stores newly found exceptions (once, by identity),
 * and moves the run: no open exception -> READY_FOR_CALCULATION; otherwise EXCEPTIONS_PENDING (rule 14).
 */
async function advance(who: Who, runId: string, correlationId: string, ai?: AiProvider) {
  const run = await loadRun(who.companyId, runId);
  const input = await loadInput(who.companyId, run);
  const existing = must(await db().from("exceptions").select("id, dedupe_key, status, resolution_action").eq("company_id", who.companyId).eq("run_id", runId).in("category", RECON_CATEGORIES), "exceptions read");
  const resolved = new Map(existing.filter((e) => e.status === "RESOLVED" && e.resolution_action).map((e) => [e.dedupe_key as string, e.resolution_action as ResolutionAction]));
  const analysis = analyse(input, resolved);
  const known = new Set(existing.map((e) => e.dedupe_key));
  const fresh = analysis.exceptions.filter((e) => !known.has(e.key));

  if (fresh.length) {
    const suggestions = await suggestForExceptions({ companyId: who.companyId, correlationId }, fresh, input, ai);
    const rows = fresh.map((e) => ({
      id: randomUUID(), company_id: who.companyId, run_id: runId, worker_id: e.workerId, category: e.category, severity: e.severity,
      evidence: e.evidence, options: e.options, dedupe_key: e.key, ai_execution_id: suggestions.executionId, ai_suggestion: suggestions.byKey.get(e.key) ?? null,
    }));
    must(await db().from("exceptions").upsert(rows, { onConflict: "company_id,run_id,dedupe_key", ignoreDuplicates: true }).select("id"), "exceptions insert");
    await writeAudit(auditEvent({ companyId: who.companyId, event: "reconciliation.raise", entityType: "payroll_run", entityId: runId, actor: who.userId, actorType: "system", correlationId, refs: { raised: fresh.length } }));
  }

  const open = existing.filter((e) => OPEN_STATES.includes(e.status)).length + fresh.length;
  const req = (action: string) => ({ id: runId, companyId: who.companyId, action, actor: who.userId, actorType: "user" as const, correlationId });
  let status = run.status;
  if (status === "RECONCILING") status = await applyTransition(runStore, runMachine, req(open ? "raise_exceptions" : "finish_reconciliation"));
  else if (status === "EXCEPTIONS_PENDING" && !open) status = await applyTransition(runStore, runMachine, req("resolve_exceptions"));
  return { status, open };
}

/** Freezes the run's data and runs the checks. Imports are no longer accepted afterwards (ARCHITECTURE 11). */
export async function reconcileRun(who: Who, runId: string, ai?: AiProvider) {
  const correlationId = need(who);
  const run = await loadRun(who.companyId, runId);
  if (run.status !== "DATA_IMPORTED") throw new TransitionError("INVALID_TRANSITION", `reconciliation starts from DATA_IMPORTED, not ${run.status}`);
  await applyTransition(runStore, runMachine, { id: runId, companyId: who.companyId, action: "start_reconciliation", actor: who.userId, actorType: "user", correlationId });
  return advance(who, runId, correlationId, ai);
}

interface Row {
  id: string;
  run_id: string;
  category: ReconCategory;
  status: string;
  options: ResolutionAction[];
}

async function applyResolution(who: Who, row: Row, action: ResolutionAction, note: string, correlationId: string) {
  const req = (a: string, refs?: Record<string, string>) => ({ id: row.id, companyId: who.companyId, action: a, actor: who.userId, actorType: "user" as const, correlationId, refs });
  if (row.status === "OPEN") await applyTransition(exceptionStore, exceptionMachine, req("start_review"));
  const saved = await db()
    .from("exceptions")
    .update({ resolution_action: action, resolution: await sealField(who.companyId, "exceptions", "resolution", row.id, note), resolved_by: who.userId, resolved_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("company_id", who.companyId)
    .eq("status", "IN_REVIEW")
    .select("id");
  if (saved.error || !saved.data?.length) throw new TransitionError("STALE_STATE", "the exception changed; reload and try again");
  await applyTransition(exceptionStore, exceptionMachine, req("resolve", { action, runId: row.run_id }));
}

const ROW = "id, run_id, category, status, options";
const noteOk = (note: string) => note.trim().length >= 3;

export async function resolveException(who: Who, id: string, input: { action: ResolutionAction; note: string }, ai?: AiProvider) {
  const correlationId = need(who);
  const row = (await db().from("exceptions").select(ROW).eq("id", id).eq("company_id", who.companyId).maybeSingle()).data as Row | null;
  if (!row) throw new TransitionError("NOT_FOUND", "exception not found");
  if (!RECON_CATEGORIES.includes(row.category)) throw new WorkflowError("FORBIDDEN", "this exception is resolved by its own workflow");
  if (!row.options.includes(input.action)) throw new WorkflowError("FORBIDDEN", "that decision is not offered for this exception");
  if (!noteOk(input.note)) throw new WorkflowError("FORBIDDEN", "a note explaining the decision is required");
  await applyResolution(who, row, input.action, input.note.trim(), correlationId);
  return advance(who, row.run_id, correlationId, ai);
}

/** One category, one decision, one note, up to 200 exceptions of one run. All-or-nothing validation (S60); each exception still gets its own resolution and audit events. */
export async function bulkResolve(who: Who, input: { runId: string; category: ReconCategory; ids: string[]; action: ResolutionAction; note: string }, ai?: AiProvider) {
  const correlationId = need(who);
  const ids = [...new Set(input.ids)];
  if (ids.length === 0 || ids.length > 200) throw new WorkflowError("FORBIDDEN", "choose between 1 and 200 exceptions");
  if (!noteOk(input.note)) throw new WorkflowError("FORBIDDEN", "a note explaining the decision is required");
  if (!OPTIONS[input.category].includes(input.action)) throw new WorkflowError("FORBIDDEN", "that decision does not belong to this category");
  const rows = must(await db().from("exceptions").select(ROW).eq("company_id", who.companyId).eq("run_id", input.runId).in("id", ids), "exceptions read") as unknown as Row[];
  const bad = rows.length !== ids.length || rows.some((r) => r.category !== input.category || !["OPEN", "IN_REVIEW"].includes(r.status) || !r.options.includes(input.action));
  if (bad) throw new TransitionError("INVALID_TRANSITION", "every selected exception must be open, in this run, of this category and accept this decision; nothing was changed");
  for (const row of rows) await applyResolution(who, row, input.action, input.note.trim(), correlationId);
  await writeAudit(auditEvent({ companyId: who.companyId, event: "exception.bulk_resolve", entityType: "payroll_run", entityId: input.runId, actor: who.userId, actorType: "user", correlationId, refs: { category: input.category, action: input.action, count: rows.length } }));
  return { resolved: rows.length, ...(await advance(who, input.runId, correlationId, ai)) };
}

export interface ExceptionView {
  id: string;
  runId: string;
  worker: string;
  category: ReconCategory;
  severity: string;
  status: string;
  facts: Record<string, string>;
  recordCount: number;
  options: ResolutionAction[];
  suggestion: { action: ResolutionAction; confidence: string } | null;
  decision: ResolutionAction | null;
  note: string | null;
  createdAt: string;
}

/** Page read on the user-scoped client (RLS); the resolution note is decrypted here. */
export async function listExceptions(client: SupabaseClient, companyId: string, runId: string): Promise<ExceptionView[]> {
  const rows = must(await client.from("exceptions").select("id, run_id, worker_id, category, severity, status, evidence, options, ai_suggestion, resolution_action, resolution, created_at").eq("company_id", companyId).eq("run_id", runId).in("category", RECON_CATEGORIES).order("created_at"), "exceptions read");
  const workers = new Map(must(await client.from("workers").select("id, pseudonym").eq("company_id", companyId), "workers read").map((w) => [w.id, w.pseudonym as string]));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id, runId: r.run_id, worker: workers.get(r.worker_id) ?? "?", category: r.category, severity: r.severity, status: r.status,
      facts: r.evidence?.facts ?? {}, recordCount: (r.evidence?.recordIds ?? []).length, options: r.options, suggestion: r.ai_suggestion, decision: r.resolution_action,
      note: r.resolution ? await openField(companyId, "exceptions", "resolution", r.id, r.resolution) : null, createdAt: r.created_at,
    })),
  );
}

/** Records named by an exception: EXCEPTION while any of its exceptions is open, MATCHED_AFTER_REVIEW once all are resolved. Everything else is AUTO_MATCHED. */
export async function flaggedRecords(client: SupabaseClient, companyId: string, runId: string) {
  const ex = must(await client.from("exceptions").select("status, evidence").eq("company_id", companyId).eq("run_id", runId).in("category", RECON_CATEGORIES), "exceptions read");
  const flagged = new Map<string, "EXCEPTION" | "MATCHED_AFTER_REVIEW">();
  for (const e of ex) for (const id of (e.evidence?.recordIds ?? []) as string[]) if (flagged.get(id) !== "EXCEPTION") flagged.set(id, OPEN_STATES.includes(e.status) ? "EXCEPTION" : "MATCHED_AFTER_REVIEW");
  return flagged;
}

/** "212 of 230 matched automatically, 18 need review": counted from the stored evidence, never estimated (ARCHITECTURE 9). */
export async function matchSummary(client: SupabaseClient, companyId: string, runId: string) {
  const count = async (table: string) => must(await client.from(table).select("id").eq("company_id", companyId).eq("run_id", runId), `${table} count`).map((r) => r.id as string);
  const records = [...(await count("timesheets")), ...(await count("leave_records"))];
  const flagged = await flaggedRecords(client, companyId, runId);
  const values = [...flagged.values()];
  return { total: records.length, autoMatched: records.length - flagged.size, afterReview: values.filter((v) => v === "MATCHED_AFTER_REVIEW").length, needReview: values.filter((v) => v === "EXCEPTION").length };
}

