import { z } from "zod";
import { CompensationSegmentSchema, type CompensationSegment } from "../engine/effective-compensation-schema";
import { CalendarDateSchema } from ".";
import type { PayrollPeriod } from "../engine";

export const EffectiveRateSchema = CompensationSegmentSchema.omit({ start: true, end: true, sourceId: true, sourceVersion: true }).extend({ id: z.string().uuid(), version: z.number().int().positive(), supersedesId: z.string().uuid().nullable() });
export type EffectiveRate = z.infer<typeof EffectiveRateSchema>;
export const ScheduleCompensationSchema = z.object({ effectiveFrom: CalendarDateSchema, payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]), baseAmount: CompensationSegmentSchema.shape.baseAmount, hourlyRate: CompensationSegmentSchema.shape.hourlyRate, expectedRevision: z.number().int().nonnegative(), baselineCompensationId: z.string().uuid(), baselineCompensationVersion: z.number().int().positive(), supersedesId: z.string().uuid().nullable(), reason: z.string().trim().min(1).max(2000), source: z.string().trim().min(1).max(500), impactedRunIds: z.array(z.string().uuid()).max(10000).refine(ids => new Set(ids).size === ids.length), idempotencyKey: z.string().uuid() }).strict();
export type ScheduleCompensation = z.infer<typeof ScheduleCompensationSchema>;
export const CompensationPreviewSchema = ScheduleCompensationSchema.omit({ impactedRunIds: true, reason: true, source: true, idempotencyKey: true }).extend({ runId: z.string().uuid() }).strict();
export type CompensationPreview = z.infer<typeof CompensationPreviewSchema>;
const next = (date: string, offset: number) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

/** Supersession is explicit within the same effective date; recording order is never rate precedence. */
export function compensationSegments(baseline: EffectiveRate, history: EffectiveRate[], period: PayrollPeriod): CompensationSegment[] {
  EffectiveRateSchema.parse(baseline); history.forEach(value => EffectiveRateSchema.parse(value));
  CalendarDateSchema.parse(period.start); CalendarDateSchema.parse(period.end);
  if (period.end < period.start || baseline.effectiveFrom > period.start || baseline.supersedesId !== null || new Set(history.map(value => value.id)).size !== history.length || new Set(history.map(value => value.version)).size !== history.length || history.some(value => value.id === baseline.id || value.effectiveFrom < baseline.effectiveFrom || value.payType !== baseline.payType)) throw new Error("invalid or incompatible effective compensation baseline/history");
  const byId = new Map(history.map(value => [value.id, value])), superseded = new Set<string>();
  for (const change of history) {
    if (!change.supersedesId) continue;
    const previous = byId.get(change.supersedesId);
    if (!previous || previous.effectiveFrom !== change.effectiveFrom || previous.version >= change.version || superseded.has(previous.id)) throw new Error("effective compensation requires explicit unambiguous same-date supersession");
    superseded.add(previous.id);
  }
  const active = history.filter(value => !superseded.has(value.id)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (new Set(active.map(value => value.effectiveFrom)).size !== active.length) throw new Error("conflicting effective compensation on the same date");
  const atStart = active.filter(value => value.effectiveFrom <= period.start).at(-1) ?? baseline;
  const rates = [atStart, ...active.filter(value => value.effectiveFrom > period.start && value.effectiveFrom <= period.end)];
  return rates.map((value, index) => ({ start: index === 0 ? period.start : value.effectiveFrom, end: rates[index + 1] ? next(rates[index + 1].effectiveFrom, -1) : period.end, effectiveFrom: value.effectiveFrom, sourceId: value.id, sourceVersion: value.version, payType: value.payType, baseAmount: value.baseAmount, hourlyRate: value.hourlyRate }));
}
