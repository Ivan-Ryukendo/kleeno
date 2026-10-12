import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TransitionError } from "@/core/domain/machines";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { buildEvidencePack } from "@/core/workflow/evidence-pack";
import type { ReviewTotals } from "@/core/workflow/review";
import { openJson } from "@/server/crypto";
import { must } from "./client";
import { loadLines } from "./calculations";
import { VALIDATED_REVIEW_STATES } from "./review-readiness";

type Actor = { companyId: string; userId: string; roles: readonly Role[] };
type Event = { id: string; action: "SIGNOFF" | "EXPORT"; calculation_id: string; calculation_hash: string; related_id: string | null; actor_id: string; created_at: string; payload_enc: string | null };
const financial = (roles: readonly Role[]) => isPayrollRole(roles) || isPaymentRole(roles);

async function currentAccess(reader: SupabaseClient, actor: Actor) {
  if (!financial(actor.roles)) throw new WorkflowError("FORBIDDEN", "Financial review membership is required");
  const result = await reader.from("memberships").select("roles,removed_at").eq("company_id", actor.companyId).eq("user_id", actor.userId).maybeSingle();
  if (result.error) throw new Error("evidence membership unavailable");
  if (!result.data || result.data.removed_at !== null || !financial(result.data.roles ?? [])) throw new WorkflowError("FORBIDDEN", "Current membership cannot download calculation evidence");
}

/** No writes: independently reproduce captured calculation and existing export before disclosure. */
export async function downloadEvidencePack(reader: SupabaseClient, actor: Actor, runId: string) {
  z.string().uuid().parse(runId);
  await currentAccess(reader, actor);
  const runResult = await reader.from("payroll_runs").select("id,status,period_start,period_end,config_version").eq("company_id", actor.companyId).eq("id", runId).maybeSingle();
  if (runResult.error) throw new Error("evidence run unavailable");
  const run = runResult.data;
  if (!run) throw new TransitionError("NOT_FOUND", "Run not found");
  if (!VALIDATED_REVIEW_STATES.includes(run.status)) throw new WorkflowError("CALCULATION_BLOCKED", "A validated calculation is required");
  const calcResult = await reader.from("calculations").select("id,calculation_hash,config_version,snapshot_enc").eq("company_id", actor.companyId).eq("run_id", runId).maybeSingle();
  if (calcResult.error) throw new Error("evidence calculation unavailable");
  const calc = calcResult.data;
  if (!calc || calc.config_version !== run.config_version) throw new WorkflowError("CALCULATION_BLOCKED", "The immutable calculation is unavailable or inconsistent");
  const result = await reader.from("payroll_review_events").select("id,action,calculation_id,calculation_hash,related_id,actor_id,created_at,payload_enc", { count: "exact" }).eq("company_id", actor.companyId).eq("run_id", runId).in("action", ["SIGNOFF", "EXPORT"]);
  const events = must(result, "evidence review") as Event[];
  const signoff = events.find(event => event.action === "SIGNOFF"), exported = events.find(event => event.action === "EXPORT");
  if (result.count !== 2 || events.length !== 2 || !signoff || !exported || !exported.payload_enc || exported.related_id !== signoff.id || events.some(event => event.calculation_id !== calc.id || event.calculation_hash !== calc.calculation_hash)) throw new WorkflowError("CONFLICT", "Generate a bound human review sign-off and CSV export first");
  // Recheck fetched private evidence before opening it; stale actor roles alone never authorize a download.
  await currentAccess(reader, actor);
  const snapshot = await openJson<unknown>(actor.companyId, "calculations", "snapshot_enc", calc.id, calc.snapshot_enc);
  const manifest = await openJson<{ formatVersion: number; byteHash: string; totals: ReviewTotals }>(actor.companyId, "payroll_review_events", "payload_enc", exported.id, exported.payload_enc);
  const lines = await loadLines(reader, actor.companyId, calc.id);
  const binding = (event: Event) => ({ id: event.id, calculationId: event.calculation_id, calculationHash: event.calculation_hash, at: event.created_at });
  const pack = buildEvidencePack({ companyId: actor.companyId, run: { id: run.id, periodStart: run.period_start, periodEnd: run.period_end }, calculation: { id: calc.id, calculationHash: calc.calculation_hash, configVersion: calc.config_version }, snapshot, lines,
    signoff: { ...binding(signoff), actor: signoff.actor_id }, exported: { ...binding(exported), signoffId: exported.related_id, formatVersion: manifest.formatVersion, byteHash: manifest.byteHash, totals: manifest.totals } });
  await currentAccess(reader, actor);
  return pack;
}
