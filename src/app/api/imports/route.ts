import { z } from "zod";
import { CSV_LIMITS } from "@/core/ingest/csv";
import { FIELDS, IMPORT_TYPES } from "@/core/ingest/rows";
import { guarded } from "@/server/auth/guard";
import { importRows } from "@/server/db/imports";
import { uuid } from "@/server/schemas";

// Typed fields only (S25): the browser has already replaced names with W-codes; the raw file is never sent. The server re-checks every limit.
const Item = z.object({ row: z.number().int().min(2).max(CSV_LIMITS.rows + 1), data: z.record(z.string().max(30), z.string().max(CSV_LIMITS.cellChars)).refine(data => Object.keys(data).length <= CSV_LIMITS.columns, "at most 50 mapped columns") }).strict();
const Body = z
  .object({
    runId: uuid,
    type: z.enum(IMPORT_TYPES),
    mapping: z.record(z.string().max(30), z.number().int().min(0).max(CSV_LIMITS.columns - 1)),
    items: z.array(Item).min(1).max(CSV_LIMITS.rows),
  })
  .strict().refine(body => Object.keys(body.mapping).every(key => FIELDS[body.type].some(field => field.name === key)), { message: "unknown mapped field", path: ["mapping"] });

// Normalized JSON has its own 10 MiB budget (escaping/envelope overhead); raw files remain local and capped at 5 MiB.
export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body, maxBodyBytes: 2 * CSV_LIMITS.bytes }, async ({ actor, body, correlationId }) =>
  importRows({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body),
);
