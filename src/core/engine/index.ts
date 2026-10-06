import { canonicalHash } from "../canonical";
import { resolveScopedConfig, type PayrollConfig } from "../config";
import { div, mul, parseDecimal, parseUsdc, ratio, roundRatioToCent, type MicroUsdc, type Ratio } from "../money";
import { CalendarDateSchema, type WorkerMetadata } from "../workers";
import { z } from "zod";

export const PayAdjustmentsSchema = z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), kind: z.enum(["BONUS", "COMMISSION", "REIMBURSEMENT", "FIXED_DEDUCTION"]), amount: z.string().regex(/^\d+(\.\d{1,6})?$/).refine(v => parseUsdc(v) <= 1_000_000_000_000_000n, "amount exceeds supported cap"), reason: z.string().trim().min(1).max(300) }).strict()).max(50).refine(a => new Set(a.map(v => v.id)).size === a.length, "duplicate adjustment ID");
export type PayAdjustment = z.infer<typeof PayAdjustmentsSchema>[number];
export interface PayrollPeriod { start: string; end: string }
/** Inclusive UTC calendar dates; invalid/missing ranges never become an assumed full period. */
export function employmentDays(period: PayrollPeriod, worker: { employmentStart?: string | null; employmentEnd?: string | null }) {
  const date = (s: string) => Date.parse(`${CalendarDateSchema.parse(s)}T00:00:00Z`) / 86400000;
  const start = date(period.start), end = date(period.end);
  if (end < start) throw new Error("period ends before it starts");
  const employmentStart = worker.employmentStart ? date(worker.employmentStart) : start;
  const employmentEnd = worker.employmentEnd ? date(worker.employmentEnd) : end;
  if (worker.employmentStart && worker.employmentEnd && employmentEnd < employmentStart) throw new Error("employment ends before it starts");
  return { periodDays: end - start + 1, activeDays: Math.max(0, Math.min(end, employmentEnd) - Math.max(start, employmentStart) + 1), activeStart: Math.max(start, employmentStart), activeEnd: Math.min(end, employmentEnd) };
}

export type PayType = "SALARIED" | "HOURLY" | "RETAINER";

/** Compensation snapshot. SALARIED: baseAmount per period. RETAINER: baseAmount per period (+ hourlyRate for approved extra hours). HOURLY: hourlyRate. */
export interface EngineWorker extends Partial<WorkerMetadata> {
  workerId: string;
  pseudonym?: string;
  payType: PayType;
  baseAmount: MicroUsdc;
  hourlyRate: MicroUsdc;
}

/** Reconciled period totals (P3 buckets them by ISO week, docs/phases/P2.md). Decimal strings, default "0". */
export interface WorkerInput {
  adjustments?: PayAdjustment[];
  unpaidLeave?: { date: string; hours: string }[];
  workedHours?: string;
  approvedOvertimeHours?: string; // SALARIED: approved hours above the weekly threshold
  approvedAboveCapHours?: string; // HOURLY: approved hours above the contracted cap
  approvedExtraHours?: string; // RETAINER: approved extra hours
  paidLeaveHours?: string;
  unpaidLeaveHours?: string;
  unexplainedHours?: string; // must be 0: unexplained time is an exception, never a deduction (rule 11)
}

export interface EngineEntry {
  worker: EngineWorker;
  input: WorkerInput;
  period?: PayrollPeriod;
}

export interface TraceLine {
  component: string;
  source: string;
  rule: string;
  ruleVersion: number;
  inputs: Record<string, string>;
  step: number;
  amount: MicroUsdc; // signed: deductions are negative
}

export interface PayrollLine {
  workerId: string;
  gross: MicroUsdc;
  deductions: MicroUsdc;
  net: MicroUsdc;
  trace: TraceLine[];
}

export interface PayrollCalculation {
  configVersion: number;
  lines: PayrollLine[];
  totals: { gross: MicroUsdc; deductions: MicroUsdc; net: MicroUsdc };
  calculationHash: string;
}

/** Fail closed: the engine refuses input it cannot price without guessing. */
export class EngineBlocked extends Error {
  constructor(
    readonly workerId: string,
    readonly reason: string,
  ) {
    super(`${reason} (worker ${workerId})`);
  }
}

const ZERO = ratio(0n);
const hrs = (v: string | undefined) => (v ? parseDecimal(v) : ZERO);
const gt = (a: Ratio, b: Ratio) => a.n * b.d > b.n * a.d;
const sub = (a: Ratio, b: Ratio) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const min = (a: Ratio, b: Ratio) => (gt(a, b) ? b : a);
const micro = (v: MicroUsdc) => ratio(v);
const show = (r: Ratio) => `${r.n}/${r.d}`;

type InputKey = "paidLeaveHours" | "unpaidLeaveHours" | "approvedOvertimeHours" | "approvedAboveCapHours" | "approvedExtraHours";
const IGNORED_INPUTS: Record<PayType, InputKey[]> = {
  SALARIED: ["approvedAboveCapHours", "approvedExtraHours"],
  HOURLY: ["paidLeaveHours", "unpaidLeaveHours", "approvedOvertimeHours", "approvedExtraHours"],
  RETAINER: ["paidLeaveHours", "unpaidLeaveHours", "approvedOvertimeHours", "approvedAboveCapHours"],
};

function calculateLine(baseConfig: PayrollConfig, { worker: w, input, period }: EngineEntry): PayrollLine {
  const resolved = resolveScopedConfig(baseConfig, w);
  const config = resolved.config;
  const v = config.version;
  const trace: TraceLine[] = [];
  const add = (component: string, source: string, rule: string, inputs: Record<string, string>, amount: MicroUsdc) =>
    trace.push({ component, source, rule, ruleVersion: v, inputs, step: trace.length + 1, amount });
  const blocked = (reason: string): never => {
    throw new EngineBlocked(w.workerId, reason);
  };

  if (gt(hrs(input.unexplainedHours), ZERO)) blocked("unexplained hours: resolve the exception first");
  // Fail closed: a non-zero input this pay type ignores would silently underpay.
  for (const k of IGNORED_INPUTS[w.payType]) if (gt(hrs(input[k]), ZERO)) blocked(`${k} does not apply to ${w.payType} workers`);
  const worked = hrs(input.workedHours);
  const adjustments = PayAdjustmentsSchema.parse(input.adjustments ?? []);
  let proration = ratio(1n);
  let days: ReturnType<typeof employmentDays> | undefined;
  if (period) {
    try { days = employmentDays(period, w); } catch { blocked("invalid employment or period dates"); }
    if (w.payType !== "HOURLY" && days!.activeDays !== days!.periodDays) {
      if (config.prorationMethod !== "ACTUAL_CALENDAR_DAYS") blocked("calendar-day proration must be approved in the configuration");
      proration = ratio(BigInt(days!.activeDays), BigInt(days!.periodDays));
    }
  } else if (w.employmentStart || w.employmentEnd) blocked("employment dates require the actual payroll period");
  const base = (component: string, rule: string) => {
    add(component, "worker.compensation", rule, { baseAmount: w.baseAmount.toString() }, roundRatioToCent(micro(w.baseAmount)));
    if (proration.n !== proration.d) {
      const prorated = roundRatioToCent(mul(micro(w.baseAmount), proration));
      add("proration", "worker.employmentDates", "PRORATION", { method: "ACTUAL_CALENDAR_DAYS", periodStart: period!.start, periodEnd: period!.end, employmentStart: w.employmentStart ?? "", employmentEnd: w.employmentEnd ?? "", activeDays: String(days!.activeDays), periodDays: String(days!.periodDays) }, prorated - trace[trace.length - 1].amount);
    }
  };
  for (const d of resolved.decisions) add("scope", "config.scopedRules", d.winner, { parameter: d.parameter, category: d.category, winningRule: d.winner, overriddenRules: d.overridden.join(",") }, 0n);

  if (w.payType === "SALARIED") {
    const scheduled = parseDecimal(config.scheduledHoursPerPeriod);
    const rate = div(micro(w.baseAmount), scheduled); // exact hourly rate, never rounded on its own
    base("base", "BASE_SALARY");
    const paidLeave = hrs(input.paidLeaveHours);
    if (gt(paidLeave, ZERO)) add("paid_leave", "input.paidLeaveHours", "PAID_LEAVE", { hours: show(paidLeave) }, 0n); // no deduction
    const ot = hrs(input.approvedOvertimeHours);
    if (gt(ot, ZERO)) {
      const m = parseDecimal(config.overtimeMultiplier);
      add("overtime", "input.approvedOvertimeHours", "OVERTIME", { hours: show(ot), rate: show(rate), multiplier: config.overtimeMultiplier }, roundRatioToCent(mul(mul(rate, ot), m)));
    }
    let unpaid = hrs(input.unpaidLeaveHours);
    if (input.unpaidLeave) {
      let all = ZERO, applicable = ZERO;
      for (const leave of input.unpaidLeave) {
        const day = Date.parse(`${CalendarDateSchema.parse(leave.date)}T00:00:00Z`) / 86400000;
        const h = hrs(leave.hours);
        all = ratio(all.n * h.d + h.n * all.d, all.d * h.d);
        if (!days || (day >= days.activeStart && day <= days.activeEnd)) applicable = ratio(applicable.n * h.d + h.n * applicable.d, applicable.d * h.d);
      }
      if (gt(all, unpaid) || gt(unpaid, all)) blocked("dated unpaid leave does not match the reconciled total");
      if (gt(all, applicable)) add("unpaid_leave_excluded", "input.unpaidLeave", "PRORATION", { hours: show(sub(all, applicable)), reason: "outside active employment dates; already excluded by proration" }, 0n);
      unpaid = applicable;
    } else if (proration.n !== proration.d && gt(unpaid, ZERO)) blocked("partial employment requires dated unpaid leave evidence");
    if (gt(unpaid, ZERO)) add("unpaid_leave", "input.unpaidLeaveHours", "UNPAID_LEAVE", { hours: show(unpaid), rate: show(rate) }, -roundRatioToCent(mul(rate, unpaid)));
  } else if (w.payType === "HOURLY") {
    const rate = micro(w.hourlyRate);
    const cap = config.hourlyCapHours === null ? worked : parseDecimal(config.hourlyCapHours);
    const regular = min(worked, cap);
    add("hours", "input.workedHours", "HOURLY_RATE", { hours: show(regular), rate: w.hourlyRate.toString() }, roundRatioToCent(mul(rate, regular)));
    const above = hrs(input.approvedAboveCapHours);
    const room = sub(worked, regular); // hours worked beyond the cap
    if (gt(above, room)) blocked("approved above-cap hours exceed hours worked above the cap");
    if (gt(above, ZERO)) {
      const m = parseDecimal(config.aboveCapMultiplier);
      add("overtime", "input.approvedAboveCapHours", "OVERTIME", { hours: show(above), rate: w.hourlyRate.toString(), multiplier: config.aboveCapMultiplier }, roundRatioToCent(mul(mul(rate, above), m)));
    }
    const excluded = sub(room, above);
    if (gt(excluded, ZERO)) add("excluded_unapproved", "input.workedHours", "OVERTIME", { hours: show(excluded) }, 0n); // shown, not paid
  } else {
    base("retainer", "FIXED_RETAINER");
    const extra = hrs(input.approvedExtraHours);
    if (gt(extra, ZERO)) {
      if (w.hourlyRate === 0n) blocked("extra hours without an agreed rate");
      add("extra_hours", "input.approvedExtraHours", "HOURLY_RATE", { hours: show(extra), rate: w.hourlyRate.toString() }, roundRatioToCent(mul(micro(w.hourlyRate), extra)));
    }
  }

  for (const a of adjustments.filter(a => a.kind !== "FIXED_DEDUCTION")) add(a.kind.toLowerCase(), `hr.adjustment.${a.id}`, "ONE_OFF_ADDITION", { kind: a.kind, amount: a.amount, reason: a.reason }, roundRatioToCent(micro(parseUsdc(a.amount))));
  const gross = trace.reduce((s, t) => s + t.amount, 0n);
  if (gross < 0n) blocked("negative gross");
  let deductions = 0n;
  for (const d of config.deductions) {
    const amount = roundRatioToCent(mul(micro(gross), div(parseDecimal(d.percent), ratio(100n))));
    deductions += amount;
    add(`deduction_${d.code.toLowerCase()}`, "config.deductions", "PERCENT_DEDUCTION", { percent: d.percent, gross: gross.toString() }, -amount);
  }
  for (const a of adjustments.filter(a => a.kind === "FIXED_DEDUCTION")) {
    const amount = roundRatioToCent(micro(parseUsdc(a.amount)));
    deductions += amount;
    add(`fixed_deduction_${a.id}`, `hr.adjustment.${a.id}`, "FIXED_DEDUCTION", { amount: a.amount, reason: a.reason }, -amount);
  }
  if (deductions > gross) blocked("deductions exceed gross");
  return { workerId: w.workerId, gross, deductions, net: gross - deductions, trace };
}

export function calculatePayroll(config: PayrollConfig, entries: EngineEntry[]): PayrollCalculation {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.worker.workerId)) throw new EngineBlocked(e.worker.workerId, "more than one entry for this worker (would pay twice)");
    seen.add(e.worker.workerId);
  }
  const sorted = [...entries].sort((a, b) => (a.worker.workerId < b.worker.workerId ? -1 : 1));
  const lines = sorted.map((e) => calculateLine(config, e));
  const totals = lines.reduce((t, l) => ({ gross: t.gross + l.gross, deductions: t.deductions + l.deductions, net: t.net + l.net }), { gross: 0n, deductions: 0n, net: 0n });
  // The hash binds config version, snapshots (compensation + inputs), lines and totals (rule 9, ARCHITECTURE 10).
  const calculationHash = canonicalHash({ config, entries: sorted, lines, totals });
  return { configVersion: config.version, lines, totals, calculationHash };
}

/** Independent checks before CALCULATION_VALIDATED (ARCHITECTURE 10). Empty list = valid. */
export function verifyCalculation(config: PayrollConfig, entries: EngineEntry[], calc: PayrollCalculation): string[] {
  const problems: string[] = [];
  let totals = { gross: 0n, deductions: 0n, net: 0n };
  for (const l of calc.lines) {
    if (l.net !== l.gross - l.deductions) problems.push(`${l.workerId}: net != gross - deductions`);
    if (l.net < 0n) problems.push(`${l.workerId}: negative net`);
    if (l.trace.length === 0) problems.push(`${l.workerId}: no trace`);
    if (l.trace.reduce((s, t) => s + t.amount, 0n) !== l.net) problems.push(`${l.workerId}: trace does not sum to net`);
    totals = { gross: totals.gross + l.gross, deductions: totals.deductions + l.deductions, net: totals.net + l.net };
  }
  if (totals.gross !== calc.totals.gross || totals.deductions !== calc.totals.deductions || totals.net !== calc.totals.net) problems.push("totals do not match line sums");
  if (calculatePayroll(config, entries).calculationHash !== calc.calculationHash) problems.push("recomputation does not reproduce the hash");
  return problems;
}
