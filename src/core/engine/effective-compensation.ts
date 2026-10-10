import { div, mul, parseDecimal, ratio, roundRatioToCent, type Ratio } from "../money";
import type { PayrollConfig } from "../config";
import { employmentDays, EngineBlocked, type EngineEntry, type TraceLine } from ".";

import { CompensationSegmentsSchema, DatedHoursSchema, type CompensationSegment } from "./effective-compensation-schema";
export { CompensationSegmentSchema, CompensationSegmentsSchema, DatedHoursSchema, type CompensationSegment, type DatedHours } from "./effective-compensation-schema";
const zero = ratio(0n);
const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Ratio, b: Ratio) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const gt = (a: Ratio, b: Ratio) => a.n * b.d > b.n * a.d;
const min = (a: Ratio, b: Ratio) => gt(a, b) ? b : a;
const hrs = (value?: string) => value ? parseDecimal(value) : zero;
const show = (value: Ratio) => `${value.n}/${value.d}`;
const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86400000;

/** Explicit optional contract; the legacy calculation path and its field presence stay unchanged. */
export function segmentedComponents(config: PayrollConfig, entry: EngineEntry): Omit<TraceLine, "step">[] {
  const { worker, input, period } = entry;
  const blocked = (reason: string): never => { throw new EngineBlocked(worker.workerId, reason); };
  const parsed = CompensationSegmentsSchema.safeParse(entry.compensationSegments), dated = DatedHoursSchema.safeParse(input.datedHours ?? []);
  if (!parsed.success || !dated.success || !period) return blocked("effective compensation requires valid segments and dated reviewed inputs");
  const segments = parsed.data, rows = dated.data.sort((a, b) => a.date.localeCompare(b.date));
  const days = employmentDays(period, worker);
  if (worker.payType !== "HOURLY" && config.prorationMethod !== "ACTUAL_CALENDAR_DAYS") return blocked("effective compensation requires approved calendar-day proration");
  if (segments[0].start !== period.start || segments.at(-1)!.end !== period.end || segments.some((segment, index) => segment.end < segment.start || segment.effectiveFrom > segment.start || segment.payType !== worker.payType || index > 0 && day(segment.start) !== day(segments[index - 1].end) + 1)) return blocked("effective compensation has missing, overlapping or mixed-pay-type segments");
  if (new Set(rows.map(row => row.date)).size !== rows.length || rows.some(row => row.date < period.start || row.date > period.end)) return blocked("dated reviewed inputs must have unique dates inside the period");
  const keys = ["workedHours", "approvedOvertimeHours", "approvedAboveCapHours", "approvedExtraHours", "paidLeaveHours", "unpaidLeaveHours"] as const;
  for (const key of keys) {
    const total = rows.reduce((sum, row) => add(sum, hrs(row[key])), zero), reconciled = hrs(input[key]);
    if (gt(total, reconciled) || gt(reconciled, total)) return blocked(`dated ${key} does not match the reconciled total; pooled evidence cannot price split compensation`);
  }
  const trace: Omit<TraceLine, "step">[] = [];
  const emit = (component: string, rule: string, segment: CompensationSegment, inputs: Record<string, string>, amount: bigint) => trace.push({ component, source: `compensation.effective.${segment.sourceId}`, rule, ruleVersion: config.version, inputs: { ...inputs, effectiveFrom: segment.effectiveFrom, segmentStart: segment.start, segmentEnd: segment.end, compensationVersion: String(segment.sourceVersion) }, amount });
  let remainingCap = config.hourlyCapHours === null ? rows.reduce((sum, row) => add(sum, hrs(row.workedHours)), zero) : parseDecimal(config.hourlyCapHours);
  for (const segment of segments) {
    if (worker.payType !== "HOURLY") {
      const activeDays = Math.max(0, Math.min(day(segment.end), days.activeEnd) - Math.max(day(segment.start), days.activeStart) + 1);
      emit(worker.payType === "SALARIED" ? "base" : "retainer", worker.payType === "SALARIED" ? "BASE_SALARY" : "FIXED_RETAINER", segment, { baseAmount: segment.baseAmount, activeDays: String(activeDays), periodDays: String(days.periodDays), method: "ACTUAL_CALENDAR_DAYS" }, roundRatioToCent(mul(ratio(BigInt(segment.baseAmount)), ratio(BigInt(activeDays), BigInt(days.periodDays)))));
    }
    const selected = rows.filter(row => row.date >= segment.start && row.date <= segment.end);
    const amountHours = (key: typeof keys[number]) => selected.reduce((sum, row) => add(sum, hrs(row[key])), zero);
    if (worker.payType === "SALARIED") {
      const rate = div(ratio(BigInt(segment.baseAmount)), parseDecimal(config.scheduledHoursPerPeriod));
      const ot = amountHours("approvedOvertimeHours");
      if (gt(ot, zero)) emit("overtime", "OVERTIME", segment, { hours: show(ot), rate: show(rate), multiplier: config.overtimeMultiplier }, roundRatioToCent(mul(mul(rate, ot), parseDecimal(config.overtimeMultiplier))));
      const unpaid = selected.filter(row => day(row.date) >= days.activeStart && day(row.date) <= days.activeEnd).reduce((sum, row) => add(sum, hrs(row.unpaidLeaveHours)), zero);
      if (gt(unpaid, zero)) emit("unpaid_leave", "UNPAID_LEAVE", segment, { hours: show(unpaid), rate: show(rate) }, -roundRatioToCent(mul(rate, unpaid)));
      const paid = amountHours("paidLeaveHours");
      if (gt(paid, zero)) emit("paid_leave", "PAID_LEAVE", segment, { hours: show(paid) }, 0n);
    } else if (worker.payType === "HOURLY") {
      let regular = zero, above = zero, excluded = zero;
      for (const row of selected) {
        const worked = hrs(row.workedHours), covered = min(worked, remainingCap), room = sub(worked, covered), approved = hrs(row.approvedAboveCapHours);
        if (gt(approved, room)) return blocked("dated above-cap approval exceeds actual excess on its work date; approval cannot move between dates");
        remainingCap = sub(remainingCap, covered); regular = add(regular, covered); above = add(above, approved); excluded = add(excluded, sub(room, approved));
      }
      const rate = ratio(BigInt(segment.hourlyRate));
      emit("hours", "HOURLY_RATE", segment, { hours: show(regular), rate: segment.hourlyRate }, roundRatioToCent(mul(rate, regular)));
      if (gt(above, zero)) emit("overtime", "OVERTIME", segment, { hours: show(above), rate: segment.hourlyRate, multiplier: config.aboveCapMultiplier }, roundRatioToCent(mul(mul(rate, above), parseDecimal(config.aboveCapMultiplier))));
      if (gt(excluded, zero)) emit("excluded_unapproved", "OVERTIME", segment, { hours: show(excluded) }, 0n);
    } else {
      const extra = amountHours("approvedExtraHours");
      if (gt(extra, zero)) {
        if (BigInt(segment.hourlyRate) === 0n) return blocked("extra hours without an agreed effective rate");
        emit("extra_hours", "HOURLY_RATE", segment, { hours: show(extra), rate: segment.hourlyRate }, roundRatioToCent(mul(ratio(BigInt(segment.hourlyRate)), extra)));
      }
    }
  }
  return trace;
}
