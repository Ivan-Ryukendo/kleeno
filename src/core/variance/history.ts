import { employmentDays, type PayrollLine, type PayrollPeriod, type TraceLine } from "../engine";
import { ratio, type Ratio } from "../money";

export interface HistoricalRun {
  id: string;
  companyId: string;
  period: PayrollPeriod;
  validated: boolean;
  calculationHash: string;
  configVersion: number;
  lines: PayrollLine[];
}
export interface AmountChange { previous: bigint; current: bigint; delta: bigint }
export interface ComponentChange extends AmountChange { component: string; previousTrace: TraceLine[]; currentTrace: TraceLine[] }
export interface WorkerChange {
  workerId: string;
  change: "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";
  gross: AmountChange;
  deductions: AmountChange;
  net: AmountChange;
  netPercent: Ratio | null;
  components: ComponentChange[];
}
export interface HistoryComparison {
  status: "COMPARED" | "NO_BASELINE" | "INCOMPARABLE" | "CURRENT_UNVALIDATED";
  reason: string | null;
  baseline: Omit<HistoricalRun, "lines"> | null;
  current: Omit<HistoricalRun, "lines">;
  totals: { gross: AmountChange; deductions: AmountChange; net: AmountChange } | null;
  workers: WorkerChange[];
}
const change = (previous: bigint, current: bigint): AmountChange => ({ previous, current, delta: current - previous });
const metadata = (run: HistoricalRun): Omit<HistoricalRun, "lines"> => ({ id: run.id, companyId: run.companyId, period: run.period, validated: run.validated, calculationHash: run.calculationHash, configVersion: run.configVersion });
function checkedLines(run: HistoricalRun) {
  const map = new Map<string, PayrollLine>();
  for (const line of run.lines) {
    if (map.has(line.workerId)) throw new Error("duplicate worker in historical calculation");
    if (line.net !== line.gross - line.deductions || line.net < 0n || line.trace.length === 0 || line.trace.reduce((s, t) => s + t.amount, 0n) !== line.net) throw new Error("historical trace or totals are inconsistent");
    map.set(line.workerId, line);
  }
  return map;
}

/** Compare only the explicitly selected immutable, comparable baseline. Never infer a missing period as zero. */
export function compareHistory(current: HistoricalRun, baseline: HistoricalRun | null): HistoryComparison {
  const unavailable = (status: HistoryComparison["status"], reason: string): HistoryComparison => ({ status, reason, baseline: null, current: metadata(current), totals: null, workers: [] });
  if (!current.validated) return unavailable("CURRENT_UNVALIDATED", "Current calculation has not been validated");
  if (!baseline) return unavailable("NO_BASELINE", "Select a prior comparable validated run");
  const currentDays = employmentDays(current.period, {}).periodDays, baselineDays = employmentDays(baseline.period, {}).periodDays;
  if (!baseline.validated || baseline.companyId !== current.companyId || baseline.period.end >= current.period.start || currentDays !== baselineDays) return unavailable("INCOMPARABLE", "Baseline must belong to this company, be validated, precede this period and have the same period length");
  const previousBy = checkedLines(baseline), currentBy = checkedLines(current);
  const workers = [...new Set([...previousBy.keys(), ...currentBy.keys()])].sort().map((workerId): WorkerChange => {
    const before = previousBy.get(workerId), after = currentBy.get(workerId);
    const components = [...new Set([...(before?.trace ?? []), ...(after?.trace ?? [])].map(t => t.component))].sort().map((component): ComponentChange => {
      const previousTrace = before?.trace.filter(t => t.component === component) ?? [], currentTrace = after?.trace.filter(t => t.component === component) ?? [];
      return { component, ...change(previousTrace.reduce((s, t) => s + t.amount, 0n), currentTrace.reduce((s, t) => s + t.amount, 0n)), previousTrace, currentTrace };
    });
    const gross = change(before?.gross ?? 0n, after?.gross ?? 0n), deductions = change(before?.deductions ?? 0n, after?.deductions ?? 0n), net = change(before?.net ?? 0n, after?.net ?? 0n);
    return { workerId, change: !before ? "ADDED" : !after ? "REMOVED" : gross.delta || deductions.delta || components.some(c => c.delta !== 0n) ? "CHANGED" : "UNCHANGED", gross, deductions, net, netPercent: net.previous === 0n ? null : ratio(net.delta * 100n, net.previous), components };
  });
  const total = (field: "gross" | "deductions" | "net") => change(workers.reduce((s, w) => s + w[field].previous, 0n), workers.reduce((s, w) => s + w[field].current, 0n));
  return { status: "COMPARED", reason: null, baseline: metadata(baseline), current: metadata(current), totals: { gross: total("gross"), deductions: total("deductions"), net: total("net") }, workers };
}
