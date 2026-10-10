import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
export const ReviewSettingsSchema = z.object({
  expectedRevision: z.number().int().min(0),
  cutoffAt: instant,
  timeZone: z.string().min(1).max(64).refine(value => {
    try { return !/^[+-]/.test(value) && !!new Intl.DateTimeFormat("en", { timeZone: value }); } catch { return false; }
  }, "unknown IANA time zone").transform(value => new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone),
  requiredTypes: z.array(z.enum(["TIMESHEETS", "LEAVE", "ACTUAL_PAID"])).min(1).max(3).refine(types => new Set(types).size === types.length, "duplicate requirement"),
  freshAfter: instant.nullable(),
}).strict().refine(value => !value.freshAfter || Date.parse(value.freshAfter) <= Date.parse(value.cutoffAt), "freshness must precede cutoff");

export type ReviewSettingsInput = z.infer<typeof ReviewSettingsSchema>;
