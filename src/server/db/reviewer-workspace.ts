import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareHistory, type HistoricalRun, type AmountChange } from "@/core/variance/history";
import { historicalFindings } from "@/core/variance/anomalies";
import { toHistoricalThresholds } from "@/core/variance/threshold-settings";
import { employmentDays, type EngineEntry } from "@/core/engine";
import { formatUsdc } from "@/core/money";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { isPaymentRole } from "@/core/tenancy";
import { openJson } from "@/server/crypto";
import { loadLines } from "./calculations";
import { must } from "./client";
import { loadPayrollReview } from "./payroll-review";
import { reviewReadiness, VALIDATED_REVIEW_STATES } from "./review-readiness";
import { loadHistoricalThresholds } from "./historical-thresholds";

interface RunRow { id: string; status: string; period_start: string; period_end: string; config_version: number }
async function historicalRun(client: SupabaseClient, companyId: string, run: RunRow): Promise<HistoricalRun & { traceIds: Map<string, string> }> {
  const calc = must(await client.from("calculations").select("id,calculation_hash,snapshot_enc").eq("company_id", companyId).eq("run_id", run.id).maybeSingle(), "review calculation");
  const lines = await loadLines(client, companyId, calc.id);
  const snapshot = await openJson<{ entries: EngineEntry[] }>(companyId, "calculations", "snapshot_enc", calc.id, calc.snapshot_enc);
  const expected = new Set(snapshot.entries.map(entry => entry.worker.workerId));
  if (expected.size !== snapshot.entries.length || lines.length !== expected.size || new Set(lines.map(line => line.workerId)).size !== expected.size || lines.some(line => !expected.has(line.workerId))) throw new Error("historical calculation is incomplete");
  return { id: run.id, companyId, validated: VALIDATED_REVIEW_STATES.includes(run.status), period: { start: run.period_start, end: run.period_end }, configVersion: run.config_version, calculationHash: calc.calculation_hash, lines, traceIds: new Map(lines.map(line => [line.workerId, line.id])) };
}
const amounts = (value: AmountChange) => ({ previous: formatUsdc(value.previous), current: formatUsdc(value.current), delta: formatUsdc(value.delta) });

export async function reviewerWorkspace(client: SupabaseClient, actor: { companyId: string; userId: string; roles: readonly Role[] }, runId: string, baselineId?: string) {
  if (!isPayrollRole(actor.roles) && !isPaymentRole(actor.roles)) throw new WorkflowError("FORBIDDEN", "Your role cannot inspect review calculations");
  const { companyId } = actor;
  const run = must(await client.from("payroll_runs").select("id,status,period_start,period_end,config_version").eq("company_id", companyId).eq("id", runId).maybeSingle(), "review run") as RunRow;
  const [readinessData, review, prior, thresholds] = await Promise.all([
    reviewReadiness(client, companyId, runId),
    loadPayrollReview(client, companyId, runId),
    client.from("payroll_runs").select("id,status,period_start,period_end,config_version").eq("company_id", companyId).in("status", VALIDATED_REVIEW_STATES).lt("period_end", run.period_start).order("period_end", { ascending: false }).order("id", { ascending: true }).limit(50),
    loadHistoricalThresholds(client, actor, runId),
  ]);
  const periodDays = employmentDays({ start: run.period_start, end: run.period_end }, {}).periodDays;
  const candidates = (must(prior, "review baselines") as RunRow[]).filter(candidate => employmentDays({ start: candidate.period_start, end: candidate.period_end }, {}).periodDays === periodDays);
  const selected = candidates.find(candidate => candidate.id === baselineId);
  const current = VALIDATED_REVIEW_STATES.includes(run.status) ? await historicalRun(client, companyId, run) : null;
  const comparison = current ? compareHistory(current, selected ? await historicalRun(client, companyId, selected) : null) : null;
  const policy = thresholds.version ? toHistoricalThresholds(thresholds.version, thresholds.rules) : null;
  const evaluated = comparison ? historicalFindings(comparison, policy) : { status: !policy?.rules.length ? "DISABLED" : "UNAVAILABLE", reason: !policy?.rules.length ? "Historical alerts are not configured" : "Current calculation requires validation", findings: [] };
  const findings = { ...evaluated, configurationHash: thresholds.configurationHash, findings: evaluated.findings.map(finding => ({ ...finding, previous: formatUsdc(finding.previous), current: formatUsdc(finding.current), delta: formatUsdc(finding.delta), percent: finding.percent ? { n: finding.percent.n.toString(), d: finding.percent.d.toString() } : null, previousTrace: finding.previousTrace.map(trace => ({ ...trace, amount: formatUsdc(trace.amount) })), currentTrace: finding.currentTrace.map(trace => ({ ...trace, amount: formatUsdc(trace.amount) })) })) };
  const workerIds = comparison?.workers.map(worker => worker.workerId) ?? [];
  const workerRows = workerIds.length ? must(await client.from("workers").select("id,pseudonym").eq("company_id", companyId).in("id", workerIds), "review workers") : [];
  const names = new Map(workerRows.map(worker => [worker.id, worker.pseudonym]));
  return {
    ...readinessData, review, thresholds, thresholdComponents: [...new Set(current?.lines.flatMap(line => line.trace.map(trace => trace.component)) ?? [])].sort(), findings,
    baselines: candidates.map(candidate => ({ id: candidate.id, label: `${candidate.period_start} – ${candidate.period_end} · config v${candidate.config_version} · ${candidate.id.slice(0, 8)}` })),
    selectedBaselineId: selected?.id ?? null,
    canReview: isPayrollRole(actor.roles),
    canConfigure: isPayrollRole(actor.roles) && !review.signoff,
    comparison: comparison ? { status: comparison.status, reason: baselineId && !selected ? "Selected baseline is unavailable or not comparable" : comparison.reason, baseline: comparison.baseline, totals: comparison.totals ? { gross: amounts(comparison.totals.gross), deductions: amounts(comparison.totals.deductions), net: amounts(comparison.totals.net) } : null, workers: comparison.workers.map(worker => ({ workerId: worker.workerId, worker: names.get(worker.workerId) ?? worker.workerId, change: worker.change, currentTraceId: current?.traceIds.get(worker.workerId) ?? null, net: amounts(worker.net), components: worker.components.map(component => ({ component: component.component, ...amounts(component), previousTrace: component.previousTrace.map(trace => ({ ...trace, amount: formatUsdc(trace.amount) })), currentTrace: component.currentTrace.map(trace => ({ ...trace, amount: formatUsdc(trace.amount) })) })) })) } : null,
  };
}
