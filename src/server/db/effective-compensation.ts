import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarDateSchema } from "@/core/workers";
import { compensationSegments, EffectiveRateSchema, ScheduleCompensationSchema, type EffectiveRate, type ScheduleCompensation } from "@/core/workers/effective-compensation";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { WorkflowError, type Ctx } from "@/core/workflow";
import { TransitionError } from "@/core/domain/machines";
import type { PayrollPeriod } from "@/core/engine";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";

const payloadSchema = EffectiveRateSchema.pick({ baseAmount: true, hourlyRate: true }).extend({ reason: ScheduleCompensationSchema.shape.reason, source: ScheduleCompensationSchema.shape.source }).strict();
type ScheduleRow = { id: string; worker_id: string; revision: number; effective_from: string; pay_type: EffectiveRate["payType"]; baseline_compensation_id: string; baseline_compensation_version: number; supersedes_id: string | null; payload_enc: string; actor_id: string; created_at: string };
const financial = (roles: readonly Role[]) => isPayrollRole(roles) || isPaymentRole(roles);
const rateOnly = (value: EffectiveRate) => ({ id: value.id, version: value.version, effectiveFrom: value.effectiveFrom, payType: value.payType, baseAmount: value.baseAmount, hourlyRate: value.hourlyRate, supersedesId: value.supersedesId });
type RowQuery = { range: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: unknown; count: number | null }> };
async function completeRows(query: RowQuery) {
  const rows: unknown[] = [], ids = new Set<string>(); let expected: number | null = null;
  for (;;) {
    const result = await query.range(rows.length, rows.length + 499);
    if (result.error || !result.data || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 10000 || expected !== null && result.count !== expected) throw new WorkflowError("CALCULATION_BLOCKED", "Effective compensation evidence is incomplete or exceeds the supported bound");
    expected = result.count;
    for (const value of result.data) {
      const id = (value as { id?: unknown }).id;
      if (typeof id !== "string" || ids.has(id)) throw new WorkflowError("CALCULATION_BLOCKED", "Effective compensation evidence contains duplicate or missing IDs");
      ids.add(id); rows.push(value);
    }
    if (rows.length === expected) return rows;
    if (!result.data.length || rows.length > expected) throw new WorkflowError("CALCULATION_BLOCKED", "Effective compensation evidence is incomplete");
  }
}
export async function effectiveCompensationAccess(reader: SupabaseClient, who: Ctx, write = false) {
  const permitted = write ? isPayrollRole : financial;
  if (!permitted(who.roles)) throw new WorkflowError("FORBIDDEN", "Current reviewer membership is required");
  const membership = await reader.from("memberships").select("roles,removed_at").eq("company_id", who.companyId).eq("user_id", who.userId).maybeSingle();
  if (membership.error) throw new Error("effective compensation membership unavailable");
  if (!membership.data || membership.data.removed_at !== null || !permitted(membership.data.roles ?? [])) throw new WorkflowError("FORBIDDEN", "Current membership cannot access effective compensation");
}
export async function effectiveScheduleRevisions(reader: SupabaseClient, companyId: string) {
  const rows = await completeRows(reader.from("effective_compensations").select("id,worker_id,revision", { count: "exact" }).eq("company_id", companyId).order("id")) as { id: string; worker_id: string; revision: number }[];
  const revisions = new Map<string, number>();
  for (const row of rows) revisions.set(row.worker_id, Math.max(revisions.get(row.worker_id) ?? 0, row.revision));
  return revisions;
}
export async function loadEffectiveCompensation(reader: SupabaseClient, who: Ctx, workerId: string, options: { period?: PayrollPeriod; effectiveFrom?: string } = {}) {
  z.string().uuid().parse(workerId); await effectiveCompensationAccess(reader, who);
  if (options.effectiveFrom) CalendarDateSchema.parse(options.effectiveFrom);
  const workerResult = await reader.from("workers").select("id,pay_type,active").eq("company_id", who.companyId).eq("id", workerId).maybeSingle();
  if (workerResult.error) throw new Error("effective compensation worker unavailable");
  if (!workerResult.data) throw new TransitionError("NOT_FOUND", "Worker not found");
  const worker = workerResult.data;
  const rows = await completeRows(reader.from("effective_compensations").select("id,worker_id,revision,effective_from,pay_type,baseline_compensation_id,baseline_compensation_version,supersedes_id,payload_enc,actor_id,created_at", { count: "exact" }).eq("company_id", who.companyId).eq("worker_id", workerId).order("revision")) as ScheduleRow[];
  if (rows.some((row, index) => row.revision !== index + 1)) throw new WorkflowError("CALCULATION_BLOCKED", "Effective compensation history is incomplete");
  const first = rows[0];
  let query = reader.from("compensations").select("id,version,payload_enc").eq("company_id", who.companyId).eq("worker_id", workerId);
  query = first ? query.eq("id", first.baseline_compensation_id) : query.order("version", { ascending: false }).limit(1);
  const baselineResult = await query.maybeSingle();
  if (baselineResult.error) throw new Error("effective compensation baseline unavailable");
  if (!baselineResult.data || first && baselineResult.data.version !== first.baseline_compensation_version || rows.some(row => row.baseline_compensation_id !== first.baseline_compensation_id || row.baseline_compensation_version !== first.baseline_compensation_version || row.pay_type !== worker.pay_type)) throw new WorkflowError("CALCULATION_BLOCKED", "Effective compensation requires its original pinned baseline and pay type");
  await effectiveCompensationAccess(reader, who);
  const original = baselineResult.data;
  const amounts = await openJson<{ baseAmount: string; hourlyRate: string }>(who.companyId, "compensations", "payload_enc", original.id, original.payload_enc);
  const baseline = EffectiveRateSchema.parse({ id: original.id, version: original.version, effectiveFrom: "0001-01-01", payType: worker.pay_type, baseAmount: String(amounts.baseAmount), hourlyRate: String(amounts.hourlyRate), supersedesId: null });
  const history = await Promise.all(rows.map(async row => {
    const payload = payloadSchema.parse(await openJson(who.companyId, "effective_compensations", "payload_enc", row.id, row.payload_enc));
    return { ...EffectiveRateSchema.parse({ id: row.id, version: row.revision, effectiveFrom: row.effective_from, payType: row.pay_type, supersedesId: row.supersedes_id, baseAmount: payload.baseAmount, hourlyRate: payload.hourlyRate }), actor: row.actor_id, at: row.created_at, reason: payload.reason, source: payload.source };
  }));
  // Validate all active dates/supersessions even when the caller does not request a calculation preview.
  compensationSegments(baseline, history.map(rateOnly), options.period ?? { start: "0001-01-01", end: "9999-12-31" });
  let impacts: { id: string; status: string; period_start: string; period_end: string }[] = [];
  if (options.effectiveFrom) {
    impacts = await completeRows(reader.from("payroll_runs").select("id,status,period_start,period_end", { count: "exact" }).eq("company_id", who.companyId).gte("period_end", options.effectiveFrom).order("id")) as typeof impacts;
  }
  await effectiveCompensationAccess(reader, who);
  return { workerId, active: worker.active as boolean, revision: rows.length, baseline, history, impacts, segments: options.period && rows.length ? compensationSegments(baseline, history.map(rateOnly), options.period) : null };
}
export async function scheduleCompensation(reader: SupabaseClient, who: Ctx, workerId: string, raw: ScheduleCompensation) {
  await effectiveCompensationAccess(reader, who, true); z.string().uuid().parse(workerId);
  const command = ScheduleCompensationSchema.parse(raw);
  const commandHash = await fingerprint(who.companyId, { workerId, actorId: who.userId, command });
  const priorResult = await reader.from("effective_compensations").select("id,command_hash,payload_enc").eq("company_id", who.companyId).eq("idempotency_key", command.idempotencyKey).maybeSingle();
  if (priorResult.error) throw new Error("effective compensation retry unavailable");
  const prior = priorResult.data;
  if (prior && prior.command_hash !== commandHash) throw new WorkflowError("CONFLICT", "Retry key already records different effective compensation");
  if (!prior) {
    const view = await loadEffectiveCompensation(reader, who, workerId, { effectiveFrom: command.effectiveFrom });
    if (!view.active || view.revision !== command.expectedRevision || view.baseline.id !== command.baselineCompensationId || view.baseline.version !== command.baselineCompensationVersion || view.baseline.payType !== command.payType || JSON.stringify(view.impacts.map(run => run.id).sort()) !== JSON.stringify([...command.impactedRunIds].sort())) throw new WorkflowError("CONFLICT", "Baseline, affected periods or effective compensation changed; review current evidence");
    compensationSegments(view.baseline, [...view.history.map(rateOnly), { id: randomUUID(), version: view.revision + 1, effectiveFrom: command.effectiveFrom, payType: command.payType, baseAmount: command.baseAmount, hourlyRate: command.hourlyRate, supersedesId: command.supersedesId }], { start: "0001-01-01", end: "9999-12-31" });
  }
  const id = prior?.id ?? randomUUID();
  const payload = prior?.payload_enc ?? await sealJson(who.companyId, "effective_compensations", "payload_enc", id, { baseAmount: command.baseAmount, hourlyRate: command.hourlyRate, reason: command.reason, source: command.source });
  const result = must(await db().rpc("schedule_effective_compensation", { p_company: who.companyId, p_worker: workerId, p_actor: who.userId, p_correlation: who.correlationId, p_event: { id, effective_from: command.effectiveFrom, pay_type: command.payType, expected_revision: command.expectedRevision, baseline_compensation_id: command.baselineCompensationId, baseline_compensation_version: command.baselineCompensationVersion, supersedes_id: command.supersedesId, impacted_run_ids: command.impactedRunIds, idempotency_key: command.idempotencyKey, command_hash: commandHash, payload_enc: payload } }), "effective compensation schedule") as { code: string; id?: string; revision?: number };
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current membership cannot schedule compensation");
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "Worker or baseline not found");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Effective compensation or affected periods changed; review current evidence");
  return { id: result.id, revision: result.revision };
}
