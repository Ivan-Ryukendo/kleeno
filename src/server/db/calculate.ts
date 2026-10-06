import "server-only";
import { randomUUID } from "node:crypto";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { scopeReview, scopeOverrideKey } from "@/core/config";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { calculatePayroll, EngineBlocked, verifyCalculation, PayAdjustmentsSchema, type PayAdjustment, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { analyse } from "@/core/reconciliation";
import { compareVariance } from "@/core/variance";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { openField, openJson, sealJson } from "@/server/crypto";
import { writeAudit } from "./audit";
import { saveCalculation } from "./calculations";
import { db, must } from "./client";
import { loadConfig } from "./configs";
import { loadInput, loadResolutions, loadRun } from "./reconciliation";
import { runStore } from "./runs";
import { listWorkers } from "./workers";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}

/**
 * Reconciled snapshot -> deterministic engine -> verified calculation -> variance (the SIMULATION value). The engine only
 * ever sees the inputs reconciliation produced after every exception was resolved (rule 14); AI is not involved (rule 2).
 * Safe to call again after a crash: the calculation is unique per run and only an identical hash is accepted.
 */
export async function calculateRun(who: Who, runId: string) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side calculates");
  const correlationId = who.correlationId ?? newCorrelationId();
  const run = await loadRun(who.companyId, runId);
  if (!["READY_FOR_CALCULATION", "CALCULATED"].includes(run.status)) throw new TransitionError("INVALID_TRANSITION", `a run is calculated from READY_FOR_CALCULATION, not ${run.status}`);

  const cfg = await loadConfig(who.companyId, run.config_version);
  if (!cfg) throw new WorkflowError("NO_ACTIVE_CONFIG", "the configuration of this run is missing");
  const input = await loadInput(who.companyId, run);
  const resolutions = await loadResolutions(who.companyId, runId);
  const analysis = analyse(input, resolutions);
  if (!analysis.inputs) throw new TransitionError("INVALID_TRANSITION", "resolve every exception before calculating");

  const workers = new Map((await listWorkers(db(), who.companyId)).map((w) => [w.id, w]));
  const revisionRow = (await db().from("payroll_runs").select("adjustment_revision").eq("company_id", who.companyId).eq("id", runId).single()).data;
  const adjustmentRevision = revisionRow?.adjustment_revision ?? 0;
  const adjustments = await loadRunAdjustments(db(), who.companyId, runId);
  const code = (id: string) => workers.get(id)?.pseudonym ?? "unknown worker";
  const entries: EngineEntry[] = [...analysis.inputs].map(([workerId, wi]) => {
    const w = workers.get(workerId);
    if (!w?.compensation) throw new WorkflowError("CALCULATION_BLOCKED", `${code(workerId)} has no pay set up`);
    return { worker: { workerId, pseudonym: w.pseudonym, payType: w.payType, baseAmount: w.compensation.baseAmount, hourlyRate: w.compensation.hourlyRate, ...w.metadata }, input: { ...wi, adjustments: adjustments.get(workerId) ?? [] }, period: { start: run.period_start, end: run.period_end } };
  });
  const scope = scopeReview(cfg.config, entries.map(e => e.worker));
  if (scope.problems.length || scope.overrides.some(o => !cfg.confirmedOverrideKeys.includes(scopeOverrideKey(o)))) throw new WorkflowError("CALCULATION_BLOCKED", "worker scope evidence changed; approve a new configuration with the current overrides");
  let calc;
  try {
    calc = calculatePayroll(cfg.config, entries);
  } catch (e) {
    if (e instanceof EngineBlocked) throw new WorkflowError("CALCULATION_BLOCKED", `${code(e.workerId)}: ${e.reason}`); // fails closed; no amounts in the message
    throw e;
  }

  const existing = (await db().from("calculations").select("id, calculation_hash").eq("company_id", who.companyId).eq("run_id", runId).maybeSingle()).data;
  if (existing && existing.calculation_hash !== calc.calculationHash) throw new TransitionError("STALE_STATE", "a different calculation already exists for this run");
  const evidence = async (table: string) => must(await db().from(table).select("id, source_hash").eq("company_id", who.companyId).eq("run_id", runId).order("id"), `${table} refs`);
  const calculationId =
    existing?.id ??
    (
      await saveCalculation(who.companyId, runId, cfg.config, entries, calc, {
        evidence: { timesheets: await evidence("timesheets"), leave: await evidence("leave_records"), actualPayments: await evidence("actual_payments") },
        decisions: Object.fromEntries(resolutions),
        adjustmentRevision,
      })
    ).calculationId;

  const step = (action: string) => applyTransition(runStore, runMachine, { id: runId, companyId: who.companyId, action, actor: who.userId, actorType: "user", correlationId, refs: { calculationId } });
  if (run.status === "READY_FOR_CALCULATION") await step("calculate");
  const problems = verifyCalculation(cfg.config, entries, calc);
  if (problems.length) {
    await writeAudit(auditEvent({ companyId: who.companyId, event: "calculation.invalid", entityType: "payroll_run", entityId: runId, actor: who.userId, actorType: "system", correlationId, refs: { calculationId, problems: problems.length } }));
    throw new WorkflowError("CALCULATION_BLOCKED", "the calculation failed its independent checks and cannot be validated");
  }

  const variance = await saveVariance(who.companyId, runId, calculationId, calc.lines, cfg.config.varianceTolerance);
  const status = await step("validate_calculation");
  return { calculationId, calculationHash: calc.calculationHash, status, workers: calc.lines.length, variance };
}

export async function loadRunAdjustments(reader: import("@supabase/supabase-js").SupabaseClient, companyId: string, runId: string): Promise<Map<string, PayAdjustment[]>> {
  const rows = must(await reader.from("run_adjustments").select("id,worker_id,payload_enc").eq("company_id", companyId).eq("run_id", runId), "run adjustments");
  const values = await Promise.all(rows.map(async r => [r.worker_id as string, PayAdjustmentsSchema.parse(await openJson(companyId, "run_adjustments", "payload_enc", r.id, r.payload_enc))] as const));
  return new Map(values);
}
export async function setRunAdjustments(who: Who, runId: string, workerId: string, input: PayAdjustment[]) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only HR or payroll enters adjustments");
  const adjustments = PayAdjustmentsSchema.parse(input);
  const run = await loadRun(who.companyId, runId);
  if (!["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING", "READY_FOR_CALCULATION"].includes(run.status)) throw new TransitionError("INVALID_TRANSITION", "create a new run to change calculated inputs");
  const worker = (await db().from("workers").select("id").eq("company_id", who.companyId).eq("id", workerId).maybeSingle()).data;
  if (!worker) throw new TransitionError("NOT_FOUND", "worker not found");
  const existing = (await db().from("run_adjustments").select("id").eq("company_id", who.companyId).eq("run_id", runId).eq("worker_id", workerId).maybeSingle()).data;
  const id = existing?.id ?? randomUUID(), payload_enc = await sealJson(who.companyId, "run_adjustments", "payload_enc", id, adjustments);
  if (existing) must(await db().from("run_adjustments").update({ payload_enc, created_by: who.userId, updated_at: new Date().toISOString() }).eq("company_id", who.companyId).eq("run_id", runId).eq("id", id).select("id"), "adjustments update");
  else must(await db().from("run_adjustments").insert({ id, company_id: who.companyId, run_id: runId, worker_id: workerId, payload_enc, created_by: who.userId }).select("id"), "adjustments insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "run.adjustments", entityType: "payroll_run", entityId: runId, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId(), refs: { workerId, adjustmentId: id, count: adjustments.length } }));
  return { id, count: adjustments.length };
}

/** Null when no amounts actually paid were imported for the run (there is no report to make); otherwise the number of findings. */
async function saveVariance(companyId: string, runId: string, calculationId: string, lines: { workerId: string; net: bigint }[], tolerance: string) {
  const paid = must(await db().from("actual_payments").select("id, worker_id, amount_enc").eq("company_id", companyId).eq("run_id", runId), "actual payments read");
  if (paid.length === 0) return null;
  const actual = new Map<string, bigint>();
  for (const p of paid) actual.set(p.worker_id, (actual.get(p.worker_id) ?? 0n) + BigInt(await openField(companyId, "actual_payments", "amount_enc", p.id, p.amount_enc)));
  const findings = compareVariance(lines, actual, parseUsdc(tolerance));
  if (findings.length) {
    const rows = await Promise.all(
      findings.map(async (f) => {
        const id = randomUUID();
        return { id, company_id: companyId, run_id: runId, calculation_id: calculationId, worker_id: f.workerId, kind: f.kind, detail_enc: await sealJson(companyId, "variance_findings", "detail_enc", id, { expected: f.expected, actual: f.actual, difference: f.difference }) };
      }),
    );
    must(await db().from("variance_findings").upsert(rows, { onConflict: "calculation_id,worker_id", ignoreDuplicates: true }).select("id"), "variance insert");
  }
  return findings.length;
}
