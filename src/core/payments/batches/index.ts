// Payment plans (ARCHITECTURE 14.7, rule 23). A plan holds every unpaid obligation of a run exactly once, in the batch or on
// hold, with amounts and recipients untouched. P4 builds the deterministic fallback plan; the AI Planner (P4b) must pass the
// same `checkPlan`. Pure.
import { computePlanHash, type PlanInput } from "../plan-hash";

export interface Payable {
  id: string;
  amount: bigint;
  recipient: string;
}

export const FALLBACK = "FALLBACK";

export class PlanError extends Error {
  constructor(
    readonly code: "UNKNOWN_HOLD" | "NOTHING_TO_PAY",
    message: string,
  ) {
    super(message);
  }
}

/** One batch, obligations in ID order, minus the ones the payment approver holds. */
export function buildFallbackPlan(eligible: readonly Payable[], holdIds: readonly string[]): { plan: PlanInput; planHash: string } {
  const held = new Set(holdIds);
  const known = new Set(eligible.map((o) => o.id));
  if ([...held].some((id) => !known.has(id))) throw new PlanError("UNKNOWN_HOLD", "a held obligation is not part of this run");
  const batch = eligible.filter((o) => !held.has(o.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (batch.length === 0) throw new PlanError("NOTHING_TO_PAY", "every obligation is on hold; nothing to pay");
  const plan: PlanInput = { obligations: batch.map(({ id, amount, recipient }) => ({ id, amount, recipient })), heldIds: [...held].sort(), source: FALLBACK };
  return { plan, planHash: computePlanHash(plan) };
}

export type PlanFailure = "PLAN_HASH_MISMATCH" | "UNKNOWN_OBLIGATION" | "DUPLICATE_OBLIGATION" | "MISSING_OBLIGATION" | "AMOUNT_CHANGED" | "RECIPIENT_CHANGED";

/** Signing re-checks the stored plan against the obligations as they are now. Any failure means do not sign. */
export function checkPlan(plan: PlanInput, planHash: string, eligible: readonly Payable[]): PlanFailure[] {
  const failures = new Set<PlanFailure>();
  if (computePlanHash(plan) !== planHash) failures.add("PLAN_HASH_MISMATCH");
  const byId = new Map(eligible.map((o) => [o.id, o]));
  const seen = new Set<string>();
  for (const p of [...plan.obligations, ...plan.heldIds.map((id) => ({ id, amount: null, recipient: null }))]) {
    if (seen.has(p.id)) failures.add("DUPLICATE_OBLIGATION");
    seen.add(p.id);
    const o = byId.get(p.id);
    if (!o) failures.add("UNKNOWN_OBLIGATION");
    else if (p.amount !== null && p.amount !== o.amount) failures.add("AMOUNT_CHANGED");
    else if (p.recipient !== null && p.recipient.toLowerCase() !== o.recipient.toLowerCase()) failures.add("RECIPIENT_CHANGED");
  }
  if (eligible.some((o) => !seen.has(o.id))) failures.add("MISSING_OBLIGATION");
  return [...failures];
}

export const planTotal = (plan: PlanInput) => plan.obligations.reduce((s, o) => s + o.amount, 0n);
