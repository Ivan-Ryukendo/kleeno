import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ReviewSettingsSchema, type ReviewSettingsInput } from "@/core/workflow/review-settings";
import { deriveReadiness, type ReadinessEvidence } from "@/core/workflow/readiness";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { db, must } from "./client";

export const VALIDATED_REVIEW_STATES = ["CALCULATION_VALIDATED", "PENDING_APPROVAL", "APPROVED", "OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"];
const labels = { TIMESHEETS: "Timesheet import", LEAVE: "Leave import", ACTUAL_PAID: "Actual-paid import" };
type SettingsRow = { revision: number; cutoff_at: string; time_zone: string; required_types: ReviewSettingsInput["requiredTypes"]; fresh_after: string | null };

export async function reviewReadiness(client: SupabaseClient, companyId: string, runId: string) {
  const run = must(await client.from("payroll_runs").select("id,status").eq("company_id", companyId).eq("id", runId).maybeSingle(), "review run");
  const result = await client.from("payroll_review_settings").select("revision,cutoff_at,time_zone,required_types,fresh_after").eq("company_id", companyId).eq("run_id", runId).maybeSingle();
  if (result.error) throw new Error("review settings unavailable");
  const row = result.data as SettingsRow | null;
  const settings = row ? { revision: row.revision, ...ReviewSettingsSchema.parse({ expectedRevision: row.revision, cutoffAt: row.cutoff_at, timeZone: row.time_zone, requiredTypes: row.required_types, freshAfter: row.fresh_after }) } : null;
  const problems = VALIDATED_REVIEW_STATES.includes(run.status) ? [] : ["Calculation requires deterministic validation before review sign-off"];
  const open = must(await client.from("exceptions").select("id").eq("company_id", companyId).eq("run_id", runId).in("status", ["OPEN", "IN_REVIEW", "ESCALATED"]).limit(1), "review exceptions");
  if (open.length) problems.push("Resolve open exceptions before review sign-off");
  const evidence: ReadinessEvidence[] = settings ? await Promise.all(settings.requiredTypes.map(async (type): Promise<ReadinessEvidence | null> => {
    const batch = must(await client.from("import_batches").select("id,created_at,row_count,rejected_count").eq("company_id", companyId).eq("run_id", runId).eq("import_type", type).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1), "review import")[0];
    return batch ? { requirementId: type, ref: batch.id, receivedAt: batch.created_at, observedAt: batch.created_at, valid: batch.row_count > batch.rejected_count && batch.rejected_count === 0 } : null;
  })).then(items => items.filter((item): item is ReadinessEvidence => item !== null)) : [];
  const readiness = deriveReadiness({ requirements: settings?.requiredTypes.map(type => ({ id: type, label: labels[type], required: true, ...(settings.freshAfter && { freshAfter: settings.freshAfter }) })) ?? null, evidence, cutoff: settings ? { at: settings.cutoffAt, timeZone: settings.timeZone } : null, now: new Date().toISOString(), validationProblems: problems });
  return { settings, readiness };
}

export async function assertReviewReady(client: SupabaseClient, companyId: string, runId: string) {
  const result = await reviewReadiness(client, companyId, runId);
  if (!result.settings || !result.readiness.ready) throw new WorkflowError("CALCULATION_BLOCKED", "Review requirements are incomplete; check readiness");
  return { settingsRevision: result.settings.revision };
}

export async function saveReviewSettings(who: { companyId: string; userId: string; roles: readonly Role[]; correlationId: string }, raw: ReviewSettingsInput, runId: string) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "Only the payroll side configures review requirements");
  const input = ReviewSettingsSchema.parse(raw);
  const saved = await db().rpc("save_payroll_review_settings", { p_company: who.companyId, p_run: runId, p_actor: who.userId, p_expected_revision: input.expectedRevision, p_cutoff: input.cutoffAt, p_timezone: input.timeZone, p_types: input.requiredTypes, p_fresh_after: input.freshAfter, p_correlation: who.correlationId });
  if (saved.error) {
    if (/stale review settings|signed review settings frozen/.test(saved.error.message)) throw new WorkflowError("CONFLICT", "Review settings changed or were signed; reload before editing");
    throw new Error("review settings save failed");
  }
  return { revision: saved.data as number };
}
