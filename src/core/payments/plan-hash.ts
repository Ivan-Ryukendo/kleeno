import { canonicalHash } from "../canonical";

// P1: a plan is one batch; the fuller planner arrives in P4/P4b.
export interface PlanInput {
  obligations: { id: string; amount: bigint; recipient: string }[]; // in execution order
  heldIds: string[];
  source: string; // AIExecution ID or "FALLBACK"
}

export function computePlanHash(plan: PlanInput): string {
  return canonicalHash({ ...plan, heldIds: [...plan.heldIds].sort() });
}
