import type { ReconCategory, ResolutionAction } from "@/core/reconciliation";

// Plain module: constants exported from a "use client" file are unusable (undefined) in server components.
export const CATEGORY_LABEL: Record<ReconCategory, string> = {
  DUPLICATE_TIMESHEET: "Duplicate timesheet lines",
  LEAVE_WORK_CONFLICT: "Leave and work on the same day",
  UNAPPROVED_OVERTIME: "Hours above the limit without approval",
  UNEXPLAINED_MISSING_HOURS: "Unexplained missing hours",
};
export const ACTION_LABEL: Record<ResolutionAction, string> = {
  KEEP_FIRST: "Keep the first line",
  KEEP_LATEST: "Keep the latest line",
  KEEP_ALL: "Keep all lines (separate shifts)",
  KEEP_WORK: "Keep the work, drop the leave",
  KEEP_LEAVE: "Keep the leave, drop the work",
  KEEP_BOTH: "Keep both (they fit in one day)",
  APPROVE_HOURS: "Approve these hours (they are paid)",
  EXCLUDE_HOURS: "Do not pay these hours",
  TREAT_AS_PAID_LEAVE: "Treat as paid leave (no deduction)",
  TREAT_AS_UNPAID_LEAVE: "Treat as unpaid leave (deducts pay)",
};