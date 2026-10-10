import type { AmountChange, HistoryComparison } from "./history";
import { ratio, type Ratio } from "../money";
import type { TraceLine } from "../engine";

export interface HistoricalThreshold {
  id: string;
  /** null selects each worker's net; a component name selects its signed trace total. */
  component: string | null;
  absolute?: bigint;
  percent?: Ratio;
}
export interface HistoricalThresholds { version: string; rules: HistoricalThreshold[] }
export interface HistoricalFinding extends AmountChange {
  workerId: string;
  component: string | null;
  percent: Ratio | null;
  triggeredBy: ("ABSOLUTE" | "PERCENT")[];
  thresholdId: string;
  thresholdVersion: string;
  currentRunId: string;
  baselineRunId: string;
  currentHash: string;
  baselineHash: string;
  previousTrace: TraceLine[];
  currentTrace: TraceLine[];
}
export interface HistoricalFindingsResult {
  status: "DISABLED" | "UNAVAILABLE" | "EVALUATED";
  reason: string | null;
  findings: HistoricalFinding[];
}
const abs = (n: bigint) => n < 0n ? -n : n;

/** Factual review findings only. Thresholds are explicit, versioned settings; no defaults or payment effects. */
export function historicalFindings(comparison: HistoryComparison, thresholds: HistoricalThresholds | null): HistoricalFindingsResult {
  if (!thresholds) return { status: "DISABLED", reason: "Historical thresholds are not configured", findings: [] };
  if (!thresholds.version.trim() || new Set(thresholds.rules.map(r => r.id)).size !== thresholds.rules.length || thresholds.rules.some(r => !r.id.trim() || r.component !== null && !r.component.trim() || r.absolute === undefined && r.percent === undefined || r.absolute !== undefined && r.absolute < 0n || r.percent !== undefined && (r.percent.n < 0n || r.percent.d <= 0n))) throw new Error("invalid historical threshold configuration");
  if (!thresholds.rules.length) return { status: "DISABLED", reason: "No historical alerts are configured", findings: [] };
  if (comparison.status !== "COMPARED") return { status: "UNAVAILABLE", reason: comparison.reason, findings: [] };
  const baseline = comparison.baseline;
  if (!baseline || baseline.companyId !== comparison.current.companyId || !baseline.validated || !comparison.current.validated || baseline.period.end >= comparison.current.period.start) throw new Error("invalid historical baseline");
  const findings: HistoricalFinding[] = [];
  const rules = [...thresholds.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const workers = [...comparison.workers].sort((a, b) => a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0);
  for (const worker of workers) for (const rule of rules) {
    const component = rule.component === null ? null : worker.components.find(c => c.component === rule.component);
    if (rule.component !== null && !component) continue;
    const value = component ?? worker.net;
    if (value.delta !== value.current - value.previous) throw new Error("inconsistent historical difference");
    if (value.delta === 0n) continue;
    const magnitude = abs(value.delta), previous = abs(value.previous);
    const triggeredBy: HistoricalFinding["triggeredBy"] = [];
    if (rule.absolute !== undefined && magnitude >= rule.absolute) triggeredBy.push("ABSOLUTE");
    // Cross multiplication preserves exact inclusive percent boundaries without rounding or dividing by zero.
    if (rule.percent && previous !== 0n && magnitude * 100n * rule.percent.d >= previous * rule.percent.n) triggeredBy.push("PERCENT");
    if (!triggeredBy.length) continue;
    findings.push({ ...value, workerId: worker.workerId, component: rule.component, percent: previous === 0n ? null : ratio(magnitude * 100n, previous), triggeredBy,
      thresholdId: rule.id, thresholdVersion: thresholds.version, currentRunId: comparison.current.id, baselineRunId: baseline.id, currentHash: comparison.current.calculationHash, baselineHash: baseline.calculationHash,
      previousTrace: component ? component.previousTrace : worker.components.flatMap(c => c.previousTrace), currentTrace: component ? component.currentTrace : worker.components.flatMap(c => c.currentTrace) });
  }
  return { status: "EVALUATED", reason: null, findings };
}
