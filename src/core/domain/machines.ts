// State machines (rule 13, S18). One table per machine: state -> { action -> next state }.
// Callers name an ACTION, never a target state; AI output, webhooks and clients cannot pick a state.
// The DB mirrors these pairs in `transition_allowed()` (checked by tests/db/cas.test.ts).
export interface Machine<S extends string = string, A extends string = string> {
  name: string;
  transitions: Record<S, Partial<Record<A, S>>>;
}

export class TransitionError extends Error {
  constructor(
    readonly code: "INVALID_TRANSITION" | "STALE_STATE" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

function machine<S extends string, A extends string>(name: string, transitions: Record<S, Partial<Record<A, S>>>): Machine<S, A> {
  return { name, transitions };
}

/** Target state for an action, or null when the action is not allowed from `from`. */
export function nextState<S extends string, A extends string>(m: Machine<S, A>, from: S, action: A): S | null {
  return m.transitions[from]?.[action] ?? null;
}

export const RUN_STATES = [
  "DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING", "READY_FOR_CALCULATION", "CALCULATED",
  "CALCULATION_VALIDATED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "OBLIGATIONS_CREATED",
  "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED",
] as const;
export type RunState = (typeof RUN_STATES)[number];
/** SIMULATION runs may only ever reach these (rule 17; also a DB CHECK). */
export const SIMULATION_STATES: readonly RunState[] = RUN_STATES.slice(0, 7);
/** Approved or later: what the payment gate accepts. */
export const RUN_APPROVED_OR_LATER: readonly RunState[] = ["APPROVED", "OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"];

export const runMachine = machine<RunState, string>("run", {
  DRAFT: { import_data: "DATA_IMPORTED" },
  DATA_IMPORTED: { start_reconciliation: "RECONCILING" },
  RECONCILING: { raise_exceptions: "EXCEPTIONS_PENDING", finish_reconciliation: "READY_FOR_CALCULATION" },
  EXCEPTIONS_PENDING: { resolve_exceptions: "READY_FOR_CALCULATION" },
  READY_FOR_CALCULATION: { calculate: "CALCULATED" },
  CALCULATED: { validate_calculation: "CALCULATION_VALIDATED" },
  CALCULATION_VALIDATED: { submit_for_approval: "PENDING_APPROVAL" },
  PENDING_APPROVAL: { approve: "APPROVED", reject: "REJECTED" },
  APPROVED: { create_obligations: "OBLIGATIONS_CREATED" },
  REJECTED: {},
  OBLIGATIONS_CREATED: { authorize_first_batch: "PAYMENT_IN_PROGRESS" },
  PAYMENT_IN_PROGRESS: { mark_settled: "SETTLED", mark_partially_settled: "PARTIALLY_SETTLED", mark_payment_failed: "PAYMENT_FAILED" },
  PARTIALLY_SETTLED: { authorize_batch: "PAYMENT_IN_PROGRESS" },
  PAYMENT_FAILED: { authorize_batch: "PAYMENT_IN_PROGRESS", resume_after_exception: "PAYMENT_IN_PROGRESS" },
  SETTLED: { reconcile: "RECONCILED" },
  RECONCILED: {},
});

export const CONFIG_STATES = ["DRAFT", "AI_PROPOSED", "VALIDATED", "HUMAN_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED", "ARCHIVED"] as const;
export type ConfigState = (typeof CONFIG_STATES)[number];
export const APPROVED_CONFIG_STATES: readonly ConfigState[] = ["APPROVED", "ACTIVE", "SUPERSEDED"];

export const configMachine = machine<ConfigState, string>("config", {
  DRAFT: { propose_ai: "AI_PROPOSED", validate: "VALIDATED", archive: "ARCHIVED" },
  AI_PROPOSED: { validate: "VALIDATED", archive: "ARCHIVED" },
  VALIDATED: { request_review: "HUMAN_REVIEW", archive: "ARCHIVED" },
  HUMAN_REVIEW: { approve: "APPROVED", send_back: "DRAFT" },
  APPROVED: { activate: "ACTIVE" },
  ACTIVE: { supersede: "SUPERSEDED", archive: "ARCHIVED" },
  SUPERSEDED: { archive: "ARCHIVED" },
  ARCHIVED: {},
});

export const EXCEPTION_STATES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "ESCALATED"] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export const exceptionMachine = machine<ExceptionState, string>("exception", {
  OPEN: { start_review: "IN_REVIEW" },
  IN_REVIEW: { resolve: "RESOLVED", reject: "REJECTED", escalate: "ESCALATED" },
  ESCALATED: { resolve: "RESOLVED", reject: "REJECTED", return_to_review: "IN_REVIEW" },
  RESOLVED: {},
  REJECTED: {},
});

export const OBLIGATION_STATES = ["CREATED", "AUTHORIZED", "ON_HOLD", "PAYING", "SETTLED", "PAYMENT_EXCEPTION"] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

export const obligationMachine = machine<ObligationState, string>("obligation", {
  CREATED: { authorize: "AUTHORIZED", hold: "ON_HOLD" },
  ON_HOLD: { authorize: "AUTHORIZED" }, // only through a new signed batch (rule 24)
  AUTHORIZED: { claim: "PAYING", fail: "PAYMENT_EXCEPTION" },
  PAYING: { settle: "SETTLED", fail: "PAYMENT_EXCEPTION" },
  SETTLED: {},
  PAYMENT_EXCEPTION: {},
});

export const BATCH_STATES = ["PROPOSED", "AUTHORIZED", "OPEN", "COMPLETED", "CLOSED", "DISCARDED"] as const;
export type BatchState = (typeof BATCH_STATES)[number];

export const batchMachine = machine<BatchState, string>("batch", {
  PROPOSED: { authorize: "AUTHORIZED", discard: "DISCARDED" },
  AUTHORIZED: { open: "OPEN" },
  OPEN: { complete: "COMPLETED", close: "CLOSED" },
  COMPLETED: {},
  CLOSED: {},
  DISCARDED: {},
});

export const PAYMENT_STATES = ["NOT_SUBMITTED", "SUBMISSION_PENDING", "SUBMITTED", "CONFIRMED", "FAILED", "UNKNOWN"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const paymentMachine = machine<PaymentState, string>("payment", {
  NOT_SUBMITTED: { begin: "SUBMISSION_PENDING" },
  SUBMISSION_PENDING: { submitted: "SUBMITTED", fail: "FAILED", lost: "UNKNOWN" },
  SUBMITTED: { confirm: "CONFIRMED", fail: "FAILED", lost: "UNKNOWN" },
  UNKNOWN: { submitted: "SUBMITTED", confirm: "CONFIRMED", fail: "FAILED" },
  CONFIRMED: {},
  FAILED: {},
});

/** Machines mirrored in the database (status column + `transition_allowed`). */
export const DB_MACHINES = { payroll_runs: runMachine, payroll_configurations: configMachine, exceptions: exceptionMachine, obligations: obligationMachine, payment_batches: batchMachine } as const;

/** Every (machine, from, to) pair, used to build and to test the DB function. */
export function transitionPairs(m: Machine): [string, string][] {
  return Object.entries(m.transitions).flatMap(([from, acts]) => Object.values(acts as Record<string, string>).map((to): [string, string] => [from, to]));
}
