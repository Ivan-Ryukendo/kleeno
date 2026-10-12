import { z } from "zod";
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; }, "invalid calendar date");
export const WorkerMetadataSchema = z.object({
  department: z.string().trim().max(80).nullable().default(null),
  jobTitle: z.string().trim().max(80).nullable().default(null),
  workerType: z.enum(["EMPLOYEE", "CONTRACTOR"]).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  employmentStart: CalendarDateSchema.nullable().default(null),
  employmentEnd: CalendarDateSchema.nullable().default(null),
}).strict().refine(v => !v.employmentStart || !v.employmentEnd || v.employmentStart <= v.employmentEnd, "employment end precedes start").refine(v => new Set(v.tags).size === v.tags.length, "duplicate tags");
export type WorkerMetadata = z.infer<typeof WorkerMetadataSchema>;
