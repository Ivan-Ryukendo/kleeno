import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TransitionError } from "@/core/domain/machines";
import { WorkflowError, type Ctx } from "@/core/workflow";
import { assertReviewAction, buildReviewExport, ReviewCommandSchema, type ReviewCommand, type ReviewView } from "@/core/workflow/review";
import { isPayrollRole } from "@/core/tenancy";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { loadLines } from "./calculations";
import { assertReviewReady } from "./review-readiness";

type Event = { id: string; action: "SIGNOFF" | "EXPORT" | "ACKNOWLEDGE"; revision: number; actor_id: string; created_at: string; payload_enc: string | null; command_hash: string };
type Manifest = Pick<NonNullable<ReviewView["export"]>, "formatVersion" | "byteHash" | "totals">;
type Acknowledgement = Pick<NonNullable<ReviewView["acknowledgement"]>, "status" | "reference">;

async function reviewSnapshot(reader: SupabaseClient, companyId: string, runId: string) {
  const runResult = await reader.from("payroll_runs").select("id, period_start, period_end, status, config_version").eq("company_id", companyId).eq("id", runId).maybeSingle();
  const run = must({ data: runResult.data ? [runResult.data] : [], error: runResult.error }, "review run read")[0];
  if (!run) throw new TransitionError("NOT_FOUND", "run not found");
  const result = await reader.from("calculations").select("id, calculation_hash, config_version").eq("company_id", companyId).eq("run_id", runId).maybeSingle();
  const calculation = must({ data: result.data ? [result.data] : [], error: result.error }, "review calculation read")[0] ?? null;
  return { run, calculation };
}

async function latestEvent(reader: SupabaseClient, companyId: string, runId: string, action?: Event["action"]): Promise<Event | null> {
  let query = reader.from("payroll_review_events").select("id, action, revision, actor_id, created_at, payload_enc, command_hash").eq("company_id", companyId).eq("run_id", runId);
  if (action) query = query.eq("action", action);
  return (must(await query.order("revision", { ascending: false }).limit(1), "review event read")[0] as Event | undefined) ?? null;
}

export async function loadPayrollReview(reader: SupabaseClient, companyId: string, runId: string): Promise<ReviewView> {
  const { calculation } = await reviewSnapshot(reader, companyId, runId);
  const [latest, signoff, exported, acknowledged] = await Promise.all([latestEvent(reader, companyId, runId), latestEvent(reader, companyId, runId, "SIGNOFF"), latestEvent(reader, companyId, runId, "EXPORT"), latestEvent(reader, companyId, runId, "ACKNOWLEDGE")]);
  const manifest = exported ? await openJson<Manifest>(companyId, "payroll_review_events", "payload_enc", exported.id, exported.payload_enc!) : null;
  const evidence = acknowledged ? await openJson<Acknowledgement>(companyId, "payroll_review_events", "payload_enc", acknowledged.id, acknowledged.payload_enc!) : null;
  return {
    revision: latest?.revision ?? 0, calculationId: calculation?.id ?? null, calculationHash: calculation?.calculation_hash ?? null,
    signoff: signoff ? { id: signoff.id, actor: signoff.actor_id, at: signoff.created_at } : null,
    export: exported && manifest ? { id: exported.id, ...manifest, at: exported.created_at } : null,
    acknowledgement: acknowledged && evidence ? { ...evidence, at: acknowledged.created_at } : null,
  };
}

async function exportBytes(reader: SupabaseClient, companyId: string, runId: string) {
  const { run, calculation } = await reviewSnapshot(reader, companyId, runId);
  if (!calculation) throw new WorkflowError("CALCULATION_BLOCKED", "a validated calculation is required");
  const snapshotRow = must(await reader.from("calculations").select("snapshot_enc").eq("company_id", companyId).eq("id", calculation.id).single(), "review snapshot read");
  const snapshot = await openJson<{ entries: { worker: { workerId: string } }[] }>(companyId, "calculations", "snapshot_enc", calculation.id, snapshotRow.snapshot_enc);
  const expected = snapshot.entries?.map(entry => entry.worker?.workerId);
  const expectedIds = new Set(expected);
  const lines = await loadLines(reader, companyId, calculation.id);
  // ponytail: the reader's API row cap is bounded; refuse incomplete exports, add paged line reads for larger workforces.
  if (!expected || expected.some(id => typeof id !== "string") || expectedIds.size !== expected.length || lines.length !== expected.length || new Set(lines.map(line => line.workerId)).size !== lines.length || lines.some(line => !expectedIds.has(line.workerId) || !line.trace.length || line.trace.reduce((total, trace) => total + trace.amount, 0n) !== line.net)) throw new WorkflowError("CALCULATION_BLOCKED", "the export does not contain the complete immutable worker calculation and trace");
  return buildReviewExport({ calculationId: calculation.id, calculationHash: calculation.calculation_hash, configVersion: calculation.config_version, periodStart: run.period_start, periodEnd: run.period_end, lines });
}

export async function downloadReviewExport(reader: SupabaseClient, companyId: string, runId: string) {
  const view = await loadPayrollReview(reader, companyId, runId);
  if (!view.export) throw new WorkflowError("CONFLICT", "generate the signed review export first");
  const exported = await exportBytes(reader, companyId, runId);
  if (exported.byteHash !== view.export.byteHash) throw new WorkflowError("CALCULATION_BLOCKED", "the export bytes do not match their immutable manifest");
  return { filename: `kleeno-review-v1-${runId}.csv`, csv: exported.csv, byteHash: exported.byteHash };
}

/** The sole mutation is an atomic append + audit RPC; it never touches payroll approvals or payments. */
export async function payrollReviewAction(reader: SupabaseClient, who: Ctx, runId: string, input: ReviewCommand) {
  const command = ReviewCommandSchema.parse(input);
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only HR or payroll reviewers may record handoffs");
  const commandHash = await fingerprint(who.companyId, { runId, userId: who.userId, command });
  const prior = must(await reader.from("payroll_review_events").select("id, command_hash").eq("company_id", who.companyId).eq("run_id", runId).eq("idempotency_key", command.idempotencyKey).limit(1), "review command read")[0];
  if (prior) {
    if (prior.command_hash !== commandHash) throw new WorkflowError("CONFLICT", "this command key was already used for different evidence");
    // The RPC also re-checks current membership for retries; removed reviewers cannot replay old commands.
  } else assertReviewAction(await loadPayrollReview(reader, who.companyId, runId), command, who.roles);
  const settingsRevision = !prior && command.action !== "acknowledge" ? (await assertReviewReady(reader, who.companyId, runId)).settingsRevision : null;
  const exported = command.action === "export" ? await exportBytes(reader, who.companyId, runId) : null;
  const payload = exported ? { formatVersion: exported.formatVersion, byteHash: exported.byteHash, totals: exported.totals } : command.action === "acknowledge" ? { status: command.status, reference: command.reference } : null;
  const eventId = randomUUID();
  const result = must(await db().rpc("append_payroll_review", {
    p_company: who.companyId, p_run: runId, p_actor: who.userId, p_correlation: who.correlationId,
    p_event: { id: eventId, action: command.action.toUpperCase(), calculation_id: command.calculationId, calculation_hash: command.calculationHash, expected_revision: command.expectedRevision, idempotency_key: command.idempotencyKey, command_hash: commandHash, settings_revision: settingsRevision, payload_enc: payload ? await sealJson(who.companyId, "payroll_review_events", "payload_enc", eventId, payload) : null },
  }), "review append") as { code: string; id?: string };
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "run or calculation not found");
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "current membership cannot record this review");
  if (result.code === "NOT_READY") throw new WorkflowError("CALCULATION_BLOCKED", "required review evidence is missing, stale or unresolved");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "review evidence changed; refresh before continuing");
  return { view: await loadPayrollReview(reader, who.companyId, runId), ...(command.action === "export" ? { download: await downloadReviewExport(reader, who.companyId, runId) } : {}) };
}
