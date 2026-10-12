import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TransitionError } from "@/core/domain/machines";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { WorkflowError, type Ctx } from "@/core/workflow";
import { assertCorrectionPair, correctionDelta, CorrectionCommandSchema, type CorrectionRun, type CorrectionCommand } from "@/core/workflow/corrections";
import { verifyCapturedCalculation } from "@/core/workflow/evidence-pack";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { loadLines } from "./calculations";
import { VALIDATED_REVIEW_STATES } from "./review-readiness";

type Payload = { reason: string; source: string; delta: ReturnType<typeof correctionDelta> };
type Link = { id: string; original_run_id: string; replacement_run_id: string; original_calculation_id: string; replacement_calculation_id: string; original_calculation_hash: string; replacement_calculation_hash: string; original_signoff_id: string; actor_id: string; created_at: string; payload_enc: string; command_hash: string };
const financial = (roles: readonly Role[]) => isPayrollRole(roles) || isPaymentRole(roles);
async function access(reader: SupabaseClient, who: Ctx, write = false) {
  const permitted = write ? isPayrollRole : financial;
  if (!permitted(who.roles)) throw new WorkflowError("FORBIDDEN", "Current reviewer membership is required");
  const result = await reader.from("memberships").select("roles,removed_at").eq("company_id", who.companyId).eq("user_id", who.userId).maybeSingle();
  if (result.error) throw new Error("correction membership unavailable");
  if (!result.data || result.data.removed_at !== null || !permitted(result.data.roles ?? [])) throw new WorkflowError("FORBIDDEN", "Current membership cannot access correction evidence");
  return result.data.roles as Role[];
}
async function boundRun(reader: SupabaseClient, companyId: string, runId: string): Promise<CorrectionRun | null> {
  const runResult = await reader.from("payroll_runs").select("id,mode,status,period_start,period_end,config_version").eq("company_id", companyId).eq("id", runId).maybeSingle();
  if (runResult.error) throw new Error("correction run unavailable");
  if (!runResult.data) throw new TransitionError("NOT_FOUND", "Run not found");
  const run = runResult.data;
  const calcResult = await reader.from("calculations").select("id,calculation_hash,config_version").eq("company_id", companyId).eq("run_id", runId).maybeSingle();
  if (calcResult.error) throw new Error("correction calculation unavailable");
  if (!calcResult.data) return null;
  const calc = calcResult.data;
  if (calc.config_version !== run.config_version) throw new WorkflowError("CALCULATION_BLOCKED", "Calculation version does not match its immutable run");
  const latest = must(await reader.from("payroll_review_events").select("revision").eq("company_id", companyId).eq("run_id", runId).order("revision", { ascending: false }).limit(1), "correction review revision")[0];
  const signResult = await reader.from("payroll_review_events").select("id,calculation_id,calculation_hash").eq("company_id", companyId).eq("run_id", runId).eq("action", "SIGNOFF").maybeSingle();
  if (signResult.error) throw new Error("correction signoff unavailable");
  const signoff = signResult.data;
  if (signoff && (signoff.calculation_id !== calc.id || signoff.calculation_hash !== calc.calculation_hash)) throw new WorkflowError("CONFLICT", "Review sign-off does not bind the immutable calculation");
  return { id: run.id, companyId, mode: run.mode, status: run.status, periodStart: run.period_start, periodEnd: run.period_end, calculationId: calc.id, calculationHash: calc.calculation_hash, configVersion: calc.config_version, reviewRevision: latest?.revision ?? 0, signoffId: signoff?.id ?? null };
}
async function completeLines(reader: SupabaseClient, companyId: string, run: CorrectionRun) {
  const row = must(await reader.from("calculations").select("snapshot_enc").eq("company_id", companyId).eq("run_id", run.id).eq("id", run.calculationId).maybeSingle(), "correction snapshot");
  const snapshot = await openJson<{ entries: { worker: { workerId: string } }[] }>(companyId, "calculations", "snapshot_enc", run.calculationId, row.snapshot_enc);
  const ids = snapshot.entries?.map(entry => entry.worker?.workerId), expected = new Set(ids);
  const lines = await loadLines(reader, companyId, run.calculationId);
  if (!ids || !ids.length || ids.some(id => typeof id !== "string") || expected.size !== ids.length || lines.length !== ids.length || new Set(lines.map(line => line.workerId)).size !== lines.length || lines.some(line => !expected.has(line.workerId) || !line.trace.length || line.trace.reduce((total, trace) => total + trace.amount, 0n) !== line.net)) throw new WorkflowError("CALCULATION_BLOCKED", "Correction requires complete immutable lines and traces");
  verifyCapturedCalculation({ snapshot, run: { id: run.id, periodStart: run.periodStart, periodEnd: run.periodEnd }, calculation: { id: run.calculationId, calculationHash: run.calculationHash, configVersion: run.configVersion }, lines });
  return lines;
}
export async function loadReviewCorrections(reader: SupabaseClient, who: Ctx, runId: string, replacementId?: string) {
  z.string().uuid().parse(runId); await access(reader, who);
  if (replacementId) z.string().uuid().parse(replacementId);
  const current = await boundRun(reader, who.companyId, runId);
  const result = await reader.from("review_corrections").select("id,original_run_id,replacement_run_id,original_calculation_id,replacement_calculation_id,original_calculation_hash,replacement_calculation_hash,original_signoff_id,actor_id,created_at,payload_enc", { count: "exact" }).eq("company_id", who.companyId).or(`original_run_id.eq.${runId},replacement_run_id.eq.${runId}`).order("created_at");
  const rows = must(result, "correction lineage") as Link[];
  if (result.count !== rows.length || rows.length > 2) throw new Error("correction lineage incomplete");
  await access(reader, who);
  const links = await Promise.all(rows.map(async row => ({ id: row.id, originalRunId: row.original_run_id, replacementRunId: row.replacement_run_id, originalCalculationHash: row.original_calculation_hash, replacementCalculationHash: row.replacement_calculation_hash, originalSignoffId: row.original_signoff_id, actor: row.actor_id, at: row.created_at, ...await openJson<Payload>(who.companyId, "review_corrections", "payload_enc", row.id, row.payload_enc) })));
  const candidates: CorrectionRun[] = [];
  let candidatesLimited = false;
  const signedOriginal = !!current?.signoffId && VALIDATED_REVIEW_STATES.includes(current.status);
  if (current && signedOriginal && isPayrollRole(who.roles) && !rows.some(row => row.original_run_id === runId)) {
    const runs = must(await reader.from("payroll_runs").select("id").eq("company_id", who.companyId).eq("mode", "SIMULATION").eq("status", "CALCULATION_VALIDATED").eq("period_start", current.periodStart).eq("period_end", current.periodEnd).neq("id", runId).order("created_at", { ascending: false }).order("id").limit(51), "replacement candidates");
    candidatesLimited = runs.length > 50;
    // ponytail: show at most 50 recent candidate runs; add cursor pagination if correction work exceeds this ceiling.
    for (const row of runs.slice(0, 50)) {
      const candidate = await boundRun(reader, who.companyId, row.id);
      if (!candidate || candidate.signoffId || candidate.reviewRevision || candidate.calculationHash === current.calculationHash) continue;
      const linked = await reader.from("review_corrections").select("id").eq("company_id", who.companyId).eq("replacement_run_id", row.id).maybeSingle();
      if (linked.error) throw new Error("replacement lineage unavailable");
      if (!linked.data) candidates.push(candidate);
    }
  }
  let preview: { replacementRunId: string; delta: ReturnType<typeof correctionDelta> } | null = null;
  if (replacementId) {
    const replacement = candidates.find(candidate => candidate.id === replacementId);
    if (!current || !replacement) throw new WorkflowError("CONFLICT", "Selected replacement is no longer available; reload current evidence");
    assertCorrectionPair(current, replacement, { replacementRunId: replacement.id, originalCalculationId: current.calculationId, originalCalculationHash: current.calculationHash, replacementCalculationId: replacement.calculationId, replacementCalculationHash: replacement.calculationHash, originalReviewRevision: current.reviewRevision, replacementReviewRevision: 0 });
    await access(reader, who, true);
    preview = { replacementRunId: replacement.id, delta: correctionDelta(await completeLines(reader, who.companyId, current), await completeLines(reader, who.companyId, replacement)) };
  }
  const currentRoles = await access(reader, who);
  return { current, links, candidates, candidatesLimited, preview, canLink: isPayrollRole(currentRoles) && signedOriginal && !rows.some(row => row.original_run_id === runId) };
}
export async function linkReviewCorrection(reader: SupabaseClient, who: Ctx, runId: string, raw: CorrectionCommand) {
  z.string().uuid().parse(runId); const command = CorrectionCommandSchema.parse(raw); await access(reader, who, true);
  const commandHash = await fingerprint(who.companyId, { runId, actorId: who.userId, command });
  const priorResult = await reader.from("review_corrections").select("id,original_signoff_id,payload_enc,command_hash").eq("company_id", who.companyId).eq("idempotency_key", command.idempotencyKey).maybeSingle();
  if (priorResult.error) throw new Error("correction retry unavailable");
  const prior = priorResult.data;
  if (prior && prior.command_hash !== commandHash) throw new WorkflowError("CONFLICT", "Retry key already records different correction evidence");
  let id: string, signoffId: string, payload: string;
  if (prior) { id = prior.id; signoffId = prior.original_signoff_id; payload = prior.payload_enc; }
  else {
    const original = await boundRun(reader, who.companyId, runId), replacement = await boundRun(reader, who.companyId, command.replacementRunId);
    if (!original || !replacement) throw new WorkflowError("CALCULATION_BLOCKED", "Both runs require immutable validated calculations");
    assertCorrectionPair(original, replacement, command);
    await access(reader, who, true);
    const delta = correctionDelta(await completeLines(reader, who.companyId, original), await completeLines(reader, who.companyId, replacement));
    id = randomUUID(); signoffId = original.signoffId!;
    payload = await sealJson(who.companyId, "review_corrections", "payload_enc", id, { reason: command.reason, source: command.source, delta });
  }
  const result = must(await db().rpc("link_review_correction", { p_company: who.companyId, p_run: runId, p_actor: who.userId, p_correlation: who.correlationId, p_event: { id, replacement_run_id: command.replacementRunId, original_calculation_id: command.originalCalculationId, replacement_calculation_id: command.replacementCalculationId, original_calculation_hash: command.originalCalculationHash, replacement_calculation_hash: command.replacementCalculationHash, original_signoff_id: signoffId, original_review_revision: command.originalReviewRevision, replacement_review_revision: command.replacementReviewRevision, idempotency_key: command.idempotencyKey, command_hash: commandHash, payload_enc: payload } }), "correction link") as { code: string; id?: string };
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "Correction run or calculation not found");
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current membership cannot link correction evidence");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Correction evidence changed or target is already linked; reload before continuing");
  return { id: result.id };
}
