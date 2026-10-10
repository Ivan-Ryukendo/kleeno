import { resolveScopedConfig, type PayrollConfig } from "../config";
import { employmentDays, type PayType, type WorkerInput } from "../engine";
import type { WorkerMetadata } from "../workers";
import { div, mul, parseDecimal, ratio, type Ratio } from "../money";

// Reconciliation (ARCHITECTURE 9): deterministic checks detect, humans resolve, and only resolved data becomes engine input.
// Pure function of the evidence and the resolutions, so the same data always gives the same exceptions and the same totals.
// Unexplained time is never a deduction (rule 11): it becomes an exception and waits for a person.
//
// Two stages: duplicates and leave/work conflicts first. Overtime and missing hours are judged only once those are
// settled, because their answers depend on which rows count.

export type ReconCategory = "DUPLICATE_TIMESHEET" | "LEAVE_WORK_CONFLICT" | "UNAPPROVED_OVERTIME" | "UNEXPLAINED_MISSING_HOURS";
export type ResolutionAction = "KEEP_ALL" | "KEEP_FIRST" | "KEEP_LATEST" | "KEEP_WORK" | "KEEP_LEAVE" | "KEEP_BOTH" | "APPROVE_HOURS" | "EXCLUDE_HOURS" | "TREAT_AS_PAID_LEAVE" | "TREAT_AS_UNPAID_LEAVE";

/** What a person may decide per category. The AI may only suggest one of these (S22). */
export const OPTIONS: Record<ReconCategory, readonly ResolutionAction[]> = {
  DUPLICATE_TIMESHEET: ["KEEP_FIRST", "KEEP_LATEST", "KEEP_ALL"],
  LEAVE_WORK_CONFLICT: ["KEEP_WORK", "KEEP_LEAVE", "KEEP_BOTH"],
  UNAPPROVED_OVERTIME: ["APPROVE_HOURS", "EXCLUDE_HOURS"],
  UNEXPLAINED_MISSING_HOURS: ["TREAT_AS_PAID_LEAVE", "TREAT_AS_UNPAID_LEAVE"],
};
export const RECON_CATEGORIES = Object.keys(OPTIONS) as ReconCategory[];

/** What was found, in plain words, from the stored evidence (never from an AI). */
export function describeFacts(category: ReconCategory, f: Record<string, string>): string {
  if (category === "DUPLICATE_TIMESHEET") return `${f.rows} timesheet lines on ${f.date} (hours: ${f.hours})`;
  if (category === "LEAVE_WORK_CONFLICT") return `On ${f.date}: ${f.workedHours} h worked and ${f.leaveHours} h of leave${f.payType && f.payType !== "SALARIED" ? `; leave does not apply to ${f.payType.toLowerCase()} workers` : ""}`;
  if (category === "UNAPPROVED_OVERTIME") return `${f.weekStart ? `Week of ${f.weekStart}` : "This period"}: ${f.overtimeHours} h over the limit, ${f.approvedHours} approved, ${f.unapprovedHours} not approved`;
  return `${f.missingHours} h unaccounted for (scheduled ${f.scheduledHours}, worked ${f.workedHours}, leave ${f.leaveHours})`;
}

export interface ReconWorker extends Partial<WorkerMetadata> {
  id: string;
  pseudonym?: string;
  payType: PayType;
}
export interface ReconTimesheet {
  id: string;
  workerId: string;
  date: string; // YYYY-MM-DD
  hours: string;
  approvedExtraHours: string;
  seq: number; // arrival order (import time, then line occurrence): KEEP_FIRST / KEEP_LATEST use it
}
export interface ReconLeave {
  id: string;
  workerId: string;
  date: string;
  leaveType: "PAID" | "UNPAID";
  hours: string;
  seq: number;
}
export interface ReconInput {
  config: Pick<PayrollConfig, "scheduledHoursPerPeriod" | "weeklyOvertimeThresholdHours" | "hourlyCapHours"> & Pick<Partial<PayrollConfig>, "scopedRules" | "prorationMethod">;
  period: { start: string; end: string };
  workers: ReconWorker[];
  timesheets: ReconTimesheet[];
  leave: ReconLeave[];
}

export interface Detected {
  key: string; // stable identity of the issue: re-running never duplicates it
  category: ReconCategory;
  workerId: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  evidence: { recordIds: string[]; facts: Record<string, string> }; // IDs and hours only (no names, no money)
  options: readonly ResolutionAction[];
}

export interface Analysis {
  exceptions: Detected[];
  /** Engine input per worker; null while any detected exception is still unresolved (rule 14: they block calculation). */
  inputs: Map<string, WorkerInput> | null;
}

// --- exact hour arithmetic (hours have at most 2 decimals; thresholds may be fractions of weekdays/5) ---
const ZERO = ratio(0n);
const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Ratio, b: Ratio) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const gt = (a: Ratio, b: Ratio) => a.n * b.d > b.n * a.d;
const min = (a: Ratio, b: Ratio) => (gt(a, b) ? b : a);
const pos = (a: Ratio) => (gt(a, ZERO) ? a : ZERO);
const sum = (xs: Ratio[]) => xs.reduce(add, ZERO);
const hours = (s: string) => parseDecimal(s);

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
/** Exact decimal text; fails closed on a non-terminating value rather than rounding hours. */
export function toDecimal(r: Ratio): string {
  const g = gcd(r.n, r.d) || 1n;
  const n = r.n / g;
  const d = r.d / g;
  for (let k = 0; k <= 12; k++) {
    const scale = 10n ** BigInt(k);
    if (scale % d === 0n) {
      const v = (n * (scale / d)).toString().padStart(k + 1, "0");
      return k === 0 ? v : `${v.slice(0, -k)}.${v.slice(-k)}`.replace(/\.?0+$/, "");
    }
  }
  throw new Error("hours are not an exact decimal");
}

// --- dates (UTC, no time zones) ---
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(day(d).getTime() + n * 86_400_000));
const dow = (d: string) => (day(d).getUTCDay() + 6) % 7; // Monday = 0
export const isoWeekStart = (d: string) => addDays(d, -dow(d));

/** Weekdays (Mon-Fri) of the ISO week starting `weekStart` that fall inside the period. */
function weekdaysInPeriod(weekStart: string, p: { start: string; end: string }): number {
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const d = addDays(weekStart, i);
    if (d >= p.start && d <= p.end) n++;
  }
  return n;
}

const by = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

export function analyse(input: ReconInput, resolutions: ReadonlyMap<string, ResolutionAction> = new Map(), datedWorkerIds: ReadonlySet<string> = new Set()): Analysis {
  const exceptions: Detected[] = [];
  const raise = (e: Omit<Detected, "options" | "severity"> & { severity?: Detected["severity"]; options?: readonly ResolutionAction[] }) =>
    exceptions.push({ severity: "MEDIUM", options: OPTIONS[e.category], ...e });
  const decided = (key: string) => resolutions.get(key);
  const stage1Open: string[] = [];
  const effective = new Map<string, { work: ReconTimesheet[]; leave: ReconLeave[] }>(); // per worker, after stage-1 decisions

  // ---- Stage 1: duplicates, then leave/work conflicts ----
  for (const w of input.workers) {
    let work = input.timesheets.filter((t) => t.workerId === w.id).sort((a, b) => a.seq - b.seq);
    let leave = input.leave.filter((l) => l.workerId === w.id).sort((a, b) => a.seq - b.seq);

    for (const [date, rows] of by(work, (t) => t.date)) {
      if (rows.length < 2) continue;
      const key = `dup|${w.id}|${date}`;
      raise({ key, category: "DUPLICATE_TIMESHEET", workerId: w.id, severity: "HIGH", evidence: { recordIds: rows.map((r) => r.id), facts: { date, rows: String(rows.length), hours: rows.map((r) => r.hours).join(",") } } });
      const a = decided(key);
      if (!a) stage1Open.push(key);
      const keep = a === "KEEP_FIRST" ? [rows[0]] : a === "KEEP_LATEST" ? [rows[rows.length - 1]] : rows;
      work = work.filter((t) => t.date !== date || keep.includes(t));
    }

    for (const [date, rows] of by(leave, (l) => l.date)) {
      const worked = sum(work.filter((t) => t.date === date).map((t) => hours(t.hours)));
      const notApplicable = w.payType !== "SALARIED"; // leave changes salaried pay only; an hourly or retainer worker's leave would be ignored silently
      const conflict = gt(worked, ZERO) || rows.length > 1 || notApplicable;
      if (!conflict) continue;
      const key = `lw|${w.id}|${date}`;
      const options: readonly ResolutionAction[] = notApplicable ? ["KEEP_WORK"] : OPTIONS.LEAVE_WORK_CONFLICT;
      raise({ key, category: "LEAVE_WORK_CONFLICT", workerId: w.id, severity: "HIGH", options, evidence: { recordIds: [...rows.map((r) => r.id), ...work.filter((t) => t.date === date).map((t) => t.id)], facts: { date, leaveHours: rows.map((r) => r.hours).join(","), workedHours: toDecimal(worked), payType: w.payType } } });
      const a = decided(key);
      if (!a) stage1Open.push(key);
      if (a === "KEEP_WORK") leave = leave.filter((l) => l.date !== date);
      else if (a) leave = leave.filter((l) => l.date !== date || l === rows[0]); // KEEP_LEAVE / KEEP_BOTH: one leave record per day
      if (a === "KEEP_LEAVE") work = work.filter((t) => t.date !== date);
    }
    effective.set(w.id, { work, leave });
  }
  if (stage1Open.length) return { exceptions, inputs: null }; // later checks wait for these decisions

  // ---- Stage 2: overtime and missing hours, on the settled rows ----
  const inputs = new Map<string, WorkerInput>();
  for (const w of input.workers) {
    const config = resolveScopedConfig(input.config, { ...w, workerId: w.id }).config;
    const t = hours(config.weeklyOvertimeThresholdHours);
    const days = employmentDays(input.period, w);
    const partialEmployment = days.activeDays !== days.periodDays;
    const { work, leave } = effective.get(w.id)!;
    const worked = sum(work.map((r) => hours(r.hours)));
    const approvedExtra = sum(work.map((r) => hours(r.approvedExtraHours)));
    const wi: WorkerInput = { workedHours: toDecimal(worked) };

    if (w.payType === "SALARIED") {
      let overAll = ZERO;
      let approvedOt = ZERO;
      if (gt(t, ZERO)) {
        for (const [weekStart, rows] of by(work, (r) => isoWeekStart(r.date))) {
          const limit = div(mul(t, ratio(BigInt(weekdaysInPeriod(weekStart, input.period)))), ratio(5n));
          const over = pos(sub(sum(rows.map((r) => hours(r.hours))), limit));
          if (!gt(over, ZERO)) continue;
          const approved = min(sum(rows.map((r) => hours(r.approvedExtraHours))), over);
          overAll = add(overAll, over);
          const unapproved = sub(over, approved);
          if (!gt(unapproved, ZERO)) {
            approvedOt = add(approvedOt, approved);
            continue;
          }
          const key = `uo|${w.id}|${weekStart}`;
          raise({ key, category: "UNAPPROVED_OVERTIME", workerId: w.id, evidence: { recordIds: rows.map((r) => r.id), facts: { weekStart, overtimeHours: toDecimal(over), approvedHours: toDecimal(approved), unapprovedHours: toDecimal(unapproved) } } });
          approvedOt = add(approvedOt, decided(key) === "APPROVE_HOURS" ? over : approved);
        }
      }
      const paid = sum(leave.filter((l) => l.leaveType === "PAID").map((l) => hours(l.hours)));
      const unpaid = sum(leave.filter((l) => l.leaveType === "UNPAID").map((l) => hours(l.hours)));
      // ponytail: period-wide scheduled hours cannot establish a partial employment schedule; explicit dated leave still applies. Add a reviewed daily schedule before inferring missing hours here.
      const missing = partialEmployment ? ZERO : sub(hours(config.scheduledHoursPerPeriod), add(sub(worked, overAll), add(paid, unpaid)));
      let paidTotal = paid;
      let unpaidTotal = unpaid;
      if (gt(missing, ZERO)) {
        const key = `mh|${w.id}`;
        raise({ key, category: "UNEXPLAINED_MISSING_HOURS", workerId: w.id, severity: "HIGH", evidence: { recordIds: work.map((r) => r.id), facts: { scheduledHours: config.scheduledHoursPerPeriod, workedHours: toDecimal(sub(worked, overAll)), leaveHours: toDecimal(add(paid, unpaid)), missingHours: toDecimal(missing) } } });
        const a = decided(key);
        if (a === "TREAT_AS_PAID_LEAVE") paidTotal = add(paid, missing);
        if (a === "TREAT_AS_UNPAID_LEAVE") unpaidTotal = add(unpaid, missing);
      }
      Object.assign(wi, { approvedOvertimeHours: toDecimal(approvedOt), paidLeaveHours: toDecimal(paidTotal), unpaidLeaveHours: toDecimal(unpaidTotal) });
      if (partialEmployment && !gt(unpaidTotal, unpaid)) wi.unpaidLeave = leave.filter(l => l.leaveType === "UNPAID").map(l => ({ date: l.date, hours: l.hours }));
    } else if (w.payType === "HOURLY") {
      let approvedAbove = ZERO;
      if (config.hourlyCapHours !== null) {
        const over = pos(sub(worked, hours(config.hourlyCapHours)));
        if (gt(over, ZERO)) {
          const approved = min(approvedExtra, over);
          approvedAbove = approved;
          if (gt(sub(over, approved), ZERO)) {
            const key = `uo|${w.id}|period`;
            raise({ key, category: "UNAPPROVED_OVERTIME", workerId: w.id, evidence: { recordIds: work.map((r) => r.id), facts: { overtimeHours: toDecimal(over), approvedHours: toDecimal(approved), unapprovedHours: toDecimal(sub(over, approved)) } } });
            if (decided(key) === "APPROVE_HOURS") approvedAbove = over;
          }
        }
      }
      wi.approvedAboveCapHours = toDecimal(approvedAbove);
    } else {
      wi.approvedExtraHours = toDecimal(approvedExtra);
    }
    if (datedWorkerIds.has(w.id)) {
      const dates = [...new Set([...work.map(row => row.date), ...leave.map(row => row.date)])].sort();
      let capRemaining = config.hourlyCapHours === null ? worked : hours(config.hourlyCapHours);
      wi.datedHours = dates.map(date => {
        const records = work.filter(row => row.date === date), worked = sum(records.map(row => hours(row.hours)));
        const projected: NonNullable<WorkerInput["datedHours"]>[number] = { date, workedHours: toDecimal(worked) };
        if (w.payType === "SALARIED") {
          // Existing weekly overtime and missing-time resolutions are pooled; never fabricate their dates.
          projected.paidLeaveHours = toDecimal(sum(leave.filter(row => row.date === date && row.leaveType === "PAID").map(row => hours(row.hours))));
          projected.unpaidLeaveHours = toDecimal(sum(leave.filter(row => row.date === date && row.leaveType === "UNPAID").map(row => hours(row.hours))));
        } else if (w.payType === "HOURLY") {
          const regular = min(worked, capRemaining), excess = sub(worked, regular);
          capRemaining = sub(capRemaining, regular);
          projected.approvedAboveCapHours = toDecimal(min(sum(records.map(row => hours(row.approvedExtraHours))), excess));
        } else projected.approvedExtraHours = toDecimal(sum(records.map(row => hours(row.approvedExtraHours))));
        return projected;
      });
    }
    inputs.set(w.id, wi);
  }
  const unresolved = exceptions.some((e) => !decided(e.key));
  return { exceptions, inputs: unresolved ? null : inputs };
}
