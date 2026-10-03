// Where a run or batch stands once its obligations settle (ARCHITECTURE 11, 14.7). Pure: the server applies the result through the state machines.
import type { ObligationStatus } from "../ports";

export type RunOutcome = "IN_PROGRESS" | "SETTLED" | "PAYMENT_FAILED" | "PARTIALLY_SETTLED";

/** Anything still moving keeps the run IN_PROGRESS; otherwise exceptions fail it, and unpaid held or unbatched obligations make it partial. */
export function runOutcome(statuses: readonly ObligationStatus[]): RunOutcome {
  if (statuses.some((s) => s === "PAYING" || s === "AUTHORIZED")) return "IN_PROGRESS";
  if (statuses.every((s) => s === "SETTLED")) return "SETTLED";
  if (statuses.some((s) => s === "PAYMENT_EXCEPTION")) return "PAYMENT_FAILED";
  return "PARTIALLY_SETTLED";
}

/** A batch completes only when every obligation in it settled; otherwise it stays open until paid out or closed. */
export const batchComplete = (statuses: readonly ObligationStatus[]) => statuses.length > 0 && statuses.every((s) => s === "SETTLED");
