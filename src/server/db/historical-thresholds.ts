import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HistoricalThresholdRulesSchema, HistoricalThresholdSettingsSchema, type HistoricalThresholdSettingsInput, type HistoricalThresholdSettingsView } from "@/core/variance/threshold-settings";
import { isPayrollRole, isPaymentRole, WorkflowError, type Role } from "@/core/workflow";
import { TransitionError } from "@/core/domain/machines";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { loadLines } from "./calculations";
interface Actor { companyId: string; userId: string; roles: readonly Role[]; correlationId?: string }
async function currentRoles(who: Actor) {
  const result = await db().from("memberships").select("roles").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("threshold membership unavailable");
  const roles = (result.data?.roles ?? []) as Role[];
  if (!isPayrollRole(roles) && !isPaymentRole(roles)) throw new WorkflowError("FORBIDDEN", "Financial review membership is required");
  return roles;
}
async function requireRun(reader: SupabaseClient, companyId: string, runId: string) {
  const result = await reader.from("payroll_runs").select("id").eq("company_id", companyId).eq("id", runId).maybeSingle();
  if (result.error) throw new Error("threshold run unavailable");
  if (!result.data) throw new TransitionError("NOT_FOUND", "Run not found");
}
export async function loadHistoricalThresholds(reader: SupabaseClient, who: Actor, runId: string): Promise<HistoricalThresholdSettingsView> {
  await currentRoles(who); await requireRun(reader, who.companyId, runId);
  const latest = must(await reader.from("historical_threshold_versions").select("id,revision,configuration_hash,payload_enc").eq("company_id", who.companyId).eq("run_id", runId).order("revision", { ascending: false }).limit(1), "threshold version")[0];
  const signed = must(await reader.from("payroll_review_events").select("id").eq("company_id", who.companyId).eq("run_id", runId).eq("action", "SIGNOFF").limit(1), "threshold freeze").length > 0;
  const roles = await currentRoles(who); // revoked readers cannot open a fetched policy version
  const rules = latest ? HistoricalThresholdRulesSchema.parse(await openJson(who.companyId, "historical_threshold_versions", "payload_enc", latest.id, latest.payload_enc)) : [];
  return { revision: latest?.revision ?? 0, version: latest?.id ?? null, configurationHash: latest?.configuration_hash ?? null, rules, canConfigure: isPayrollRole(roles) && !signed };
}
export async function saveHistoricalThresholds(reader: SupabaseClient, who: Actor, runId: string, raw: HistoricalThresholdSettingsInput) {
  const input = HistoricalThresholdSettingsSchema.parse(raw);
  if (!isPayrollRole(await currentRoles(who))) throw new WorkflowError("FORBIDDEN", "Only HR or payroll reviewers configure thresholds");
  await requireRun(reader, who.companyId, runId);
  const calcResult = await reader.from("calculations").select("id").eq("company_id", who.companyId).eq("run_id", runId).maybeSingle();
  if (calcResult.error) throw new Error("threshold calculation unavailable");
  const components = new Set(calcResult.data ? (await loadLines(reader, who.companyId, calcResult.data.id)).flatMap(line => line.trace.map(trace => trace.component)) : []);
  if (input.rules.some(rule => rule.component !== null && !components.has(rule.component))) throw new WorkflowError("CONFLICT", "Select a component observed in this run's immutable calculation trace");
  const id = randomUUID();
  const result = must(await db().rpc("append_historical_thresholds", {
    p_company: who.companyId, p_run: runId, p_actor: who.userId, p_id: id, p_expected_revision: input.expectedRevision,
    p_idempotency_key: input.idempotencyKey, p_command_hash: await fingerprint(who.companyId, { runId, userId: who.userId, input }),
    p_configuration_hash: await fingerprint(who.companyId, input.rules), p_payload_enc: await sealJson(who.companyId, "historical_threshold_versions", "payload_enc", id, input.rules), p_correlation: who.correlationId ?? randomUUID(),
  }), "threshold append") as { code: string };
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "Run not found");
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current membership cannot configure thresholds");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Thresholds changed, are signed, or the command key was reused; refresh before continuing");
  return loadHistoricalThresholds(reader, who, runId);
}
