import { z } from "zod";
import { CalendarDateSchema } from "../workers";

const money = z.string().regex(/^\d{1,16}$/).refine(value => BigInt(value) <= 1_000_000_000_000_000n);
const hours = z.string().regex(/^\d+(\.\d+)?$/).max(80).optional();
export const CompensationSegmentSchema = z.object({ start: CalendarDateSchema, end: CalendarDateSchema, effectiveFrom: CalendarDateSchema, sourceId: z.string().uuid(), sourceVersion: z.number().int().positive(), payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]), baseAmount: money, hourlyRate: money }).strict();
export const CompensationSegmentsSchema = z.array(CompensationSegmentSchema).min(1).max(366);
export type CompensationSegment = z.infer<typeof CompensationSegmentSchema>;
export const DatedHoursSchema = z.array(z.object({ date: CalendarDateSchema, workedHours: hours, approvedOvertimeHours: hours, approvedAboveCapHours: hours, approvedExtraHours: hours, paidLeaveHours: hours, unpaidLeaveHours: hours }).strict()).max(10000);
export type DatedHours = z.infer<typeof DatedHoursSchema>;
