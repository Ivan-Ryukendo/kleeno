import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeReview, scopeOverrideKey } from "@/core/config";
import { calculatePayroll, EngineBlocked, type EngineEntry, type PayrollLine } from "@/core/engine";
import { analyse } from "@/core/reconciliation";
import { compensationSegments, CompensationPreviewSchema, type CompensationPreview, type EffectiveRate } from "@/core/workers/effective-compensation";
import { WorkflowError, type Ctx } from "@/core/workflow";
import { fingerprint } from "@/server/crypto";
import { db, must } from "./client";
import { loadRun, loadInput, loadResolutions } from "./reconciliation";
import { loadConfig } from "./configs";
import { listWorkers } from "./workers";
import { loadRunAdjustments } from "./calculate";
import { effectiveCompensationAccess, loadEffectiveCompensation } from "./effective-compensation";

const rateOnly = (value: EffectiveRate) => ({ id: value.id, version: value.version, effectiveFrom: value.effectiveFrom, payType: value.payType, baseAmount: value.baseAmount, hourlyRate: value.hourlyRate, supersedesId: value.supersedesId });
async function evidence(reader: SupabaseClient, who: Ctx, workerId: string, proposal: CompensationPreview) {
  await effectiveCompensationAccess(reader, who, true);
  const run = await loadRun(who.companyId, proposal.runId);
  if (run.status !== "READY_FOR_CALCULATION") throw new WorkflowError("CONFLICT", "Preview requires an uncalculated run ready for calculation");
  const captured = await db().from("calculations").select("id").eq("company_id", who.companyId).eq("run_id", run.id).maybeSingle();
  if (captured.error) throw new Error("preview captured evidence unavailable");
  if (captured.data) throw new WorkflowError("CONFLICT", "A captured result stays unchanged; select an uncalculated replacement run");
  const cfg = await loadConfig(who.companyId, run.config_version);
  if (!cfg) throw new WorkflowError("NO_ACTIVE_CONFIG", "Selected run configuration is unavailable");
  const timeline = await loadEffectiveCompensation(reader, who, workerId);
  if (!timeline.active || timeline.revision !== proposal.expectedRevision || timeline.baseline.id !== proposal.baselineCompensationId || timeline.baseline.version !== proposal.baselineCompensationVersion || timeline.baseline.payType !== proposal.payType) throw new WorkflowError("CONFLICT", "Baseline or timeline changed; reload current evidence");
  const input = await loadInput(who.companyId, run), resolutions = await loadResolutions(who.companyId, run.id);
  const workers = await listWorkers(reader, who.companyId), worker = workers.find(value => value.id === workerId);
  if (!worker || !input.workers.some(value => value.id === workerId) || worker.payType !== timeline.baseline.payType) throw new WorkflowError("CONFLICT", "Selected worker is not available in this run's current evidence");
  const revision = must(await db().from("payroll_runs").select("adjustment_revision").eq("company_id", who.companyId).eq("id", run.id).maybeSingle(), "preview adjustment revision").adjustment_revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new WorkflowError("CONFLICT", "Adjustment evidence is unavailable");
  const adjustments = await loadRunAdjustments(db(), who.companyId, run.id);
  await effectiveCompensationAccess(reader, who, true);
  const material = { run, config: cfg, timeline, input, resolutions: [...resolutions].sort(([a], [b]) => a.localeCompare(b)), worker, adjustmentRevision: revision, adjustments: [...adjustments].sort(([a], [b]) => a.localeCompare(b)) };
  return { run, cfg, timeline, input, resolutions, worker, adjustments, adjustmentRevision: revision, digest: await fingerprint(who.companyId, material) };
}
function summary(line: PayrollLine, proposedId?: string) {
  return { gross: line.gross.toString(), deductions: line.deductions.toString(), net: line.net.toString(), trace: line.trace.map(row => {
    const proposed = !!proposedId && row.source.includes(proposedId);
    const inputs = Object.fromEntries(Object.entries(row.inputs).filter(([key]) => key !== "reason"));
    if (proposed) { inputs.sourceKind = "PROPOSAL_ONLY"; if ("compensationSourceId" in inputs) inputs.compensationSourceId = "PROPOSAL_ONLY"; }
    return { ...row, source: proposed ? "compensation.proposal" : row.source, inputs, amount: row.amount.toString() };
  }) };
}
/** A deterministic read-only proposal. Its IDs/hashes are never recorded schedule or payroll authority. */
export async function previewEffectiveCompensation(reader: SupabaseClient, who: Ctx, workerId: string, raw: CompensationPreview) {
  const proposal = CompensationPreviewSchema.parse(raw);
  const first = await evidence(reader, who, workerId, proposal);
  const beforeAnalysis = analyse(first.input, first.resolutions, first.timeline.history.length ? new Set([workerId]) : new Set());
  const afterAnalysis = analyse(first.input, first.resolutions, new Set([workerId]));
  if (!beforeAnalysis.inputs || !afterAnalysis.inputs) throw new WorkflowError("CALCULATION_BLOCKED", "Resolve every exception before previewing pay");
  const beforeInput = beforeAnalysis.inputs.get(workerId), afterInput = afterAnalysis.inputs.get(workerId);
  if (!beforeInput || !afterInput) throw new WorkflowError("CALCULATION_BLOCKED", "Resolved worker inputs are unavailable");
  const token = await fingerprint(who.companyId, { purpose: "EFFECTIVE_COMPENSATION_PREVIEW_ONLY", workerId, proposal });
  const proposedId = `${token.slice(0, 8)}-${token.slice(8, 12)}-4${token.slice(13, 16)}-8${token.slice(17, 20)}-${token.slice(20, 32)}`;
  const pending: EffectiveRate = { id: proposedId, version: first.timeline.revision + 1, effectiveFrom: proposal.effectiveFrom, payType: proposal.payType, baseAmount: proposal.baseAmount, hourlyRate: proposal.hourlyRate, supersedesId: proposal.supersedesId };
  const period = { start: first.run.period_start, end: first.run.period_end }, history = first.timeline.history.map(rateOnly);
  const engineWorker = { workerId, pseudonym: first.worker.pseudonym, payType: first.timeline.baseline.payType, baseAmount: BigInt(first.timeline.baseline.baseAmount), hourlyRate: BigInt(first.timeline.baseline.hourlyRate), ...first.worker.metadata };
  const scope = scopeReview(first.cfg.config, [engineWorker]);
  if (scope.problems.length || scope.overrides.some(value => !first.cfg.confirmedOverrideKeys.includes(scopeOverrideKey(value)))) throw new WorkflowError("CALCULATION_BLOCKED", "Current worker scope requires an approved configuration with confirmed overrides");
  const adjustments = first.adjustments.get(workerId) ?? [];
  let before: PayrollLine, after: PayrollLine;
  try {
    const beforeEntry: EngineEntry = { worker: engineWorker, input: { ...beforeInput, adjustments }, period, compensationSegments: compensationSegments(first.timeline.baseline, history, period) };
    const afterEntry: EngineEntry = { worker: engineWorker, input: { ...afterInput, adjustments }, period, compensationSegments: compensationSegments(first.timeline.baseline, [...history, pending], period) };
    before = calculatePayroll(first.cfg.config, [beforeEntry]).lines[0]; after = calculatePayroll(first.cfg.config, [afterEntry]).lines[0];
  } catch (error) {
    if (error instanceof EngineBlocked) throw new WorkflowError("CALCULATION_BLOCKED", error.reason);
    throw new WorkflowError("CONFLICT", "Effective dates or supersession conflict with current evidence");
  }
  const second = await evidence(reader, who, workerId, proposal);
  if (first.digest !== second.digest) throw new WorkflowError("CONFLICT", "Preview evidence changed; reload and preview current inputs");
  await effectiveCompensationAccess(reader, who, true);
  return { authority: "PREVIEW_ONLY" as const, runId: first.run.id, workerId, period, configVersion: first.cfg.config.version, timelineRevision: first.timeline.revision, adjustmentRevision: first.adjustmentRevision, evidenceFingerprint: first.digest,
    proposal: { sourceId: proposedId, sourceVersion: pending.version, kind: "PROPOSAL_ONLY" as const, recorded: false as const },
    before: summary(before), after: summary(after, proposedId), delta: { gross: (after.gross - before.gross).toString(), deductions: (after.deductions - before.deductions).toString(), net: (after.net - before.net).toString() } };
}
