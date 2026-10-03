// Standing authorization (rule 25, ARCHITECTURE 14.8, S09): a payment approver signs once within limits and an expiry, and the system may then
// authorize a CLEAN batch with it. Anything unusual needs a human signature. Pure; the database enforces the same limits again (S09 trigger).
import { FALLBACK } from "./index";
import type { PlanInput } from "../plan-hash";

export interface StandingAuthorization {
  id: string;
  createdBy: string;
  maxBatchTotal: bigint;
  maxPerPayment: bigint;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type StandingFailure =
  | "REVOKED"
  | "EXPIRED"
  | "HAS_HOLDS"
  | "HAS_SIGNALS"
  | "FALLBACK_PLAN"
  | "OVER_BATCH_TOTAL"
  | "OVER_PAYMENT_LIMIT"
  | "OVER_COMPANY_CEILING"
  | "CREATOR_IS_PAYROLL_APPROVER";

export interface StandingInput {
  standing: StandingAuthorization;
  plan: PlanInput;
  /** Signals stored with the plan; any fired signal (new recipient, 2x amount, first payment, config change) needs a human. */
  signalCount: number;
  companyCeiling: bigint;
  payrollApproverId: string;
  now: Date;
}

/** Empty list = the standing authorization may sign this batch. */
export function checkStanding(i: StandingInput): StandingFailure[] {
  const f: StandingFailure[] = [];
  if (i.standing.revokedAt) f.push("REVOKED");
  if (i.standing.expiresAt <= i.now) f.push("EXPIRED");
  if (i.plan.heldIds.length > 0) f.push("HAS_HOLDS");
  if (i.signalCount > 0) f.push("HAS_SIGNALS");
  if (i.plan.source === FALLBACK) f.push("FALLBACK_PLAN");
  const total = i.plan.obligations.reduce((s, o) => s + o.amount, 0n);
  const biggest = i.plan.obligations.reduce((m, o) => (o.amount > m ? o.amount : m), 0n);
  if (total > i.standing.maxBatchTotal) f.push("OVER_BATCH_TOTAL");
  if (biggest > i.standing.maxPerPayment) f.push("OVER_PAYMENT_LIMIT");
  if (biggest > i.companyCeiling) f.push("OVER_COMPANY_CEILING");
  if (i.standing.createdBy === i.payrollApproverId) f.push("CREATOR_IS_PAYROLL_APPROVER");
  return f;
}
