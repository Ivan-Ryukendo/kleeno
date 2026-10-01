import { canonicalHash } from "../canonical";
import type { PayrollConfig } from "../config";
import { div, mul, parseDecimal, ratio, roundRatioToCent, type MicroUsdc, type Ratio } from "../money";

export type PayType = "SALARIED" | "HOURLY" | "RETAINER";

/** Compensation snapshot. SALARIED: baseAmount per period. RETAINER: baseAmount per period (+ hourlyRate for approved extra hours). HOURLY: hourlyRate. */
export interface EngineWorker {
  workerId: string;
  payType: PayType;
  baseAmount: MicroUsdc;
  hourlyRate: MicroUsdc;
}

/** Reconciled period totals (P3 buckets them by ISO week, docs/phases/P2.md). Decimal strings, default "0". */
export interface WorkerInput {
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

function calculateLine(config: PayrollConfig, { worker: w, input }: EngineEntry): PayrollLine {
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

  if (w.payType === "SALARIED") {
    const scheduled = parseDecimal(config.scheduledHoursPerPeriod);
    const rate = div(micro(w.baseAmount), scheduled); // exact hourly rate, never rounded on its own
    add("base", "worker.compensation", "BASE_SALARY", { baseAmount: w.baseAmount.toString() }, roundRatioToCent(micro(w.baseAmount)));
    const paidLeave = hrs(input.paidLeaveHours);
    if (gt(paidLeave, ZERO)) add("paid_leave", "input.paidLeaveHours", "PAID_LEAVE", { hours: show(paidLeave) }, 0n); // no deduction
    const ot = hrs(input.approvedOvertimeHours);
    if (gt(ot, ZERO)) {
      const m = parseDecimal(config.overtimeMultiplier);
      add("overtime", "input.approvedOvertimeHours", "OVERTIME", { hours: show(ot), rate: show(rate), multiplier: config.overtimeMultiplier }, roundRatioToCent(mul(mul(rate, ot), m)));
    }
    const unpaid = hrs(input.unpaidLeaveHours);
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
    add("retainer", "worker.compensation", "FIXED_RETAINER", { baseAmount: w.baseAmount.toString() }, roundRatioToCent(micro(w.baseAmount)));
    const extra = hrs(input.approvedExtraHours);
    if (gt(extra, ZERO)) {
      if (w.hourlyRate === 0n) blocked("extra hours without an agreed rate");
      add("extra_hours", "input.approvedExtraHours", "HOURLY_RATE", { hours: show(extra), rate: w.hourlyRate.toString() }, roundRatioToCent(mul(micro(w.hourlyRate), extra)));
    }
  }

  const gross = trace.reduce((s, t) => s + t.amount, 0n);
  if (gross < 0n) blocked("negative gross");
  let deductions = 0n;
  for (const d of config.deductions) {
    const amount = roundRatioToCent(mul(micro(gross), div(parseDecimal(d.percent), ratio(100n))));
    deductions += amount;
    add(`deduction_${d.code.toLowerCase()}`, "config.deductions", "PERCENT_DEDUCTION", { percent: d.percent, gross: gross.toString() }, -amount);
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
