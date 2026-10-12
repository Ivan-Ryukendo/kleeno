// Dashboard display model (R9.3). Pure functions over data the page already loaded; nothing here reads a database, and
// anything not recorded stays null so the UI can say "not recorded" instead of showing a zero (docs/pages.md).

export type StepState = "done" | "current" | "blocked" | "pending" | "unavailable";
export interface ReadinessStep { id: string; label: string; state: StepState; detail: string; href: string | null }

const ORDER = ["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING", "READY_FOR_CALCULATION", "CALCULATED", "CALCULATION_VALIDATED", "PENDING_APPROVAL", "APPROVED", "OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"];
const rank = (status: string) => ORDER.indexOf(status === "REJECTED" ? "PENDING_APPROVAL" : status); // a rejected run stopped at approval

export interface StepInput {
  runId: string;
  status: string;
  mode: string;
  policyVersion: number;
  openExceptions: number;
  liveEnabled: boolean;
  /** HR review sign-off: null when the viewer's role cannot see it (or it could not be loaded). */
  signedOff: boolean | null;
  inputs: { received: number; expected: number } | null;
  matched: { count: number; total: number } | null;
  canPayroll: boolean;
  canPay: boolean;
}

/** The seven dashboard steps (Policy, Import, Reconcile, HR review, Payroll approval, Payment approval, Settlement). Simulation never reaches the last three. */
export function readinessSteps(i: StepInput): ReadinessStep[] {
  const r = rank(i.status);
  const known = r >= 0;
  const sim = i.mode === "SIMULATION";
  const step = (id: string, label: string, state: StepState, detail: string, href: string | null): ReadinessStep => ({ id, label, state: known ? state : "unavailable", detail: known ? detail : "Status unavailable", href });
  const imported = r >= rank("DATA_IMPORTED");
  const reconcileDone = r >= rank("READY_FOR_CALCULATION") && i.openExceptions === 0;
  const calculated = r >= rank("CALCULATION_VALIDATED");
  const approvedOrLater = r >= rank("APPROVED");
  const planSigned = r >= rank("PAYMENT_IN_PROGRESS");
  const settled = r >= rank("SETTLED");
  const matchText = i.matched ? `${i.matched.count} of ${i.matched.total} records matched` : "";

  const importState: StepState = imported ? "done" : "current";
  const importDetail = i.inputs ? `${i.inputs.received} of ${i.inputs.expected} inputs received` : imported ? "Data imported" : "Waiting for source records";
  const reconcileState: StepState = reconcileDone ? "done" : i.openExceptions > 0 ? "blocked" : imported ? "current" : "pending";
  const reconcileDetail = i.openExceptions > 0 ? `${matchText ? `${matchText} · ` : ""}${i.openExceptions} open` : reconcileDone ? matchText || "No open exceptions" : imported ? "Run the checks" : "After import";

  let hrState: StepState, hrDetail: string;
  if (i.signedOff === true) { hrState = "done"; hrDetail = "Review signed off"; }
  else if (r >= rank("PENDING_APPROVAL")) { hrState = "done"; hrDetail = "Submitted for approval"; }
  else if (!reconcileDone) { hrState = "pending"; hrDetail = "After reconciliation"; }
  else if (i.signedOff === null) { hrState = calculated ? "current" : "pending"; hrDetail = calculated ? "Sign-off status is not visible to your role" : "Calculate and validate first"; }
  else { hrState = calculated ? "current" : "pending"; hrDetail = calculated ? "Waiting for sign-off" : "Calculate and validate first"; }

  const simNote = "Not used in a simulation";
  const payrollApproval: [StepState, string] = sim ? ["unavailable", simNote]
    : i.status === "REJECTED" ? ["blocked", "Rejected; start a new run"]
    : approvedOrLater ? ["done", "Approved"]
    : i.status === "PENDING_APPROVAL" ? ["current", "Waiting for approval"]
    : ["pending", "After HR review"];
  const paymentApproval: [StepState, string] = sim ? ["unavailable", simNote]
    : planSigned ? ["done", "Payment plan signed"]
    : approvedOrLater ? ["current", "Waiting for a separate payment approver"]
    : ["pending", "After payroll approval"];
  const settlement: [StepState, string] = sim ? ["unavailable", "Simulated, never pays"]
    : settled ? ["done", i.status === "RECONCILED" ? "Settled and reconciled" : "Settled; reconciliation pending"]
    : i.status === "PAYMENT_FAILED" ? ["blocked", "Payment review needed"]
    : i.status === "PARTIALLY_SETTLED" ? ["current", "Some payments remain"]
    : planSigned ? ["current", "Payments in progress"]
    : !i.liveEnabled && approvedOrLater ? ["blocked", "Live payments are off"]
    : ["pending", "After payment approval"];

  return [
    step("policy", "Policy", "done", `v${i.policyVersion} pinned`, i.canPayroll ? "/configuration" : null),
    step("import", "Import", importState, importDetail, i.canPayroll ? `/import?run=${i.runId}` : null),
    step("reconcile", "Reconcile", reconcileState, reconcileDetail, i.canPayroll ? `/exceptions?run=${i.runId}` : null),
    step("hr", "HR review", hrState, hrDetail, `/runs/${i.runId}#review-heading`),
    step("approval", "Payroll approval", payrollApproval[0], payrollApproval[1], sim ? null : `/runs/${i.runId}`),
    step("payment", "Payment approval", paymentApproval[0], paymentApproval[1], sim || !i.canPay ? null : `/settlement?run=${i.runId}`),
    step("settlement", "Settlement", settlement[0], settlement[1], sim || !i.canPay ? null : `/settlement?run=${i.runId}`),
  ];
}

/** Whole days from `now` to `at`, rounded toward zero: positive while the cutoff is ahead, negative (or -0 within the first day) once it has passed. Null for an invalid instant. */
export function daysUntil(at: string, now: Date): number | null {
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.trunc((t - now.getTime()) / 86_400_000) : null;
}
export function daysLeftText(days: number | null): string | null {
  if (days === null) return null;
  if (Object.is(days, -0)) return "Passed today";
  if (days === 0) return "Due today";
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} left` : `Passed ${-days} day${days === -1 ? "" : "s"} ago`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * Pay date from the company's own schedule, on or after the period end (pay in arrears). Monthly pay (day 1-28, 31 = last day)
 * and weekly pay (weekday 1 = Monday) are derivable; every other schedule has no anchor date, so it returns null.
 */
export function payDateFor(frequency: string | null, payDay: number | null, periodEnd: string): string | null {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  if (payDay === null || Number.isNaN(end.getTime())) return null;
  if (frequency === "MONTHLY" && ((payDay >= 1 && payDay <= 28) || payDay === 31)) {
    for (let add = 0; add < 2; add++) {
      const y = end.getUTCFullYear(), m = end.getUTCMonth() + add;
      const day = payDay === 31 ? lastDayOf(y, m) : payDay;
      const candidate = new Date(Date.UTC(y, m, day));
      if (candidate >= end) return iso(candidate);
    }
    return null;
  }
  if (frequency === "WEEKLY" && payDay >= 1 && payDay <= 7) {
    const jsDay = payDay % 7; // 1 = Monday ... 7 = Sunday -> getUTCDay 1..6, 0
    const shift = (jsDay - end.getUTCDay() + 7) % 7;
    return iso(new Date(end.getTime() + shift * 86_400_000));
  }
  return null;
}

export interface RunLite { status: string; period_end: string }
export interface MonthCell { month: number; letter: string; state: "settled" | "pending" | "none"; label: string }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The twelve months of one calendar year (the selected run's year). A month is settled when a run ending in it is SETTLED or RECONCILED;
 * the selected run's month is pending until then. `settledRuns` must be the complete list for the year (see settledRunsOfYear).
 */
export function monthStrip(settledRuns: readonly RunLite[], year: number, selectedEnd: string): { cells: MonthCell[]; settled: number } {
  const selectedMonth = selectedEnd.startsWith(`${year}-`) ? Number(selectedEnd.slice(5, 7)) : 0;
  const settledMonths = new Set(settledRuns.filter((r) => ["SETTLED", "RECONCILED"].includes(r.status) && r.period_end.startsWith(`${year}-`)).map((r) => Number(r.period_end.slice(5, 7))));
  const cells = MONTHS.map((name, i): MonthCell => {
    const state = settledMonths.has(i + 1) ? "settled" : i + 1 === selectedMonth ? "pending" : "none";
    return { month: i + 1, letter: name[0], state, label: `${name}: ${state === "settled" ? "settled" : state === "pending" ? "not settled yet" : "no settled run"}` };
  });
  return { cells, settled: cells.filter((c) => c.state === "settled").length };
}

export const monthName = (isoDate: string) => MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? "";
