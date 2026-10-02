import { z } from "zod";
import { parseUsdc } from "../money";
import type { ObjectType } from "../integrations";

// What the server accepts from an import (S25): mapped, typed fields only. Worker names never appear here; the browser
// has already replaced them with W-codes (rule 35). Currency is USD only (rule 7).
export const IMPORT_TYPES = ["TIMESHEETS", "LEAVE", "ACTUAL_PAID"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const OBJECT_OF: Record<ImportType, ObjectType> = { TIMESHEETS: "timesheet", LEAVE: "leave", ACTUAL_PAID: "actual_payment" };

const workerRef = z.string().regex(/^W\d{3,}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v));
const hours = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/)
  .refine((v) => Number(v) <= 24);

export const TimesheetRow = z.object({ workerRef, date, hours, approvedExtraHours: hours.default("0") }).strict();
export const LeaveRow = z.object({ workerRef, date, leaveType: z.enum(["PAID", "UNPAID"]), hours }).strict();
export const ActualPaidRow = z
  .object({
    workerRef,
    amount: z.string().refine((v) => {
      try {
        return parseUsdc(v) <= 1_000_000_000n * 1_000_000n;
      } catch {
        return false;
      }
    }),
    currency: z.literal("USD").default("USD"),
  })
  .strict();

export const ROW_SCHEMAS = { TIMESHEETS: TimesheetRow, LEAVE: LeaveRow, ACTUAL_PAID: ActualPaidRow } as const;
export type TimesheetRowT = z.infer<typeof TimesheetRow>;
export type LeaveRowT = z.infer<typeof LeaveRow>;
export type ActualPaidRowT = z.infer<typeof ActualPaidRow>;

/** Fields a column can be mapped to, per import type. `required` ones must be mapped before upload. */
export const FIELDS: Record<ImportType, { name: string; label: string; required: boolean }[]> = {
  TIMESHEETS: [
    { name: "workerRef", label: "Worker (name or code)", required: true },
    { name: "date", label: "Date", required: true },
    { name: "hours", label: "Hours worked", required: true },
    { name: "approvedExtraHours", label: "Approved extra hours", required: false },
  ],
  LEAVE: [
    { name: "workerRef", label: "Worker (name or code)", required: true },
    { name: "date", label: "Date", required: true },
    { name: "leaveType", label: "Leave type (PAID or UNPAID)", required: true },
    { name: "hours", label: "Hours", required: true },
  ],
  ACTUAL_PAID: [
    { name: "workerRef", label: "Worker (name or code)", required: true },
    { name: "amount", label: "Amount paid", required: true },
    { name: "currency", label: "Currency (must be USD)", required: false },
  ],
};

/** Rejected rows carry a row number and a fixed code, never the cell text (S25, S45). */
export type RejectCode = "MISSING" | "BAD_VALUE" | "CURRENCY" | "UNKNOWN_WORKER" | "OUT_OF_PERIOD";
export interface Rejected {
  row: number;
  field: string;
  code: RejectCode;
}

/** One mapped CSV row. `row` is the line number in the user's file (header = 1), so rejects point at the right line. */
export interface RowItem {
  row: number;
  data: unknown;
}

/** Validate typed rows against the schema; returns the good ones and the rejects. */
export function validateRows<T extends ImportType>(type: T, items: RowItem[]) {
  const schema = ROW_SCHEMAS[type];
  const good: { row: number; value: z.infer<(typeof ROW_SCHEMAS)[T]> }[] = [];
  const rejected: Rejected[] = [];
  for (const { row, data } of items) {
    const parsed = schema.safeParse(data);
    if (parsed.success) {
      good.push({ row, value: parsed.data as z.infer<(typeof ROW_SCHEMAS)[T]> });
      continue;
    }
    const issue = parsed.error.issues[0];
    const unknownField = issue.code === "unrecognized_keys";
    const field = unknownField ? "row" : String(issue.path[0] ?? "row");
    const raw = (data as Record<string, unknown> | null)?.[field];
    rejected.push({ row, field, code: field === "currency" ? "CURRENCY" : !unknownField && (raw === undefined || raw === "") ? "MISSING" : "BAD_VALUE" });
  }
  return { good, rejected };
}
