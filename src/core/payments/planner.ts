import type { PlannerOutput } from "../ai/planner";
import { checkPlan, PlanError, type Payable } from "./batches";
import { computePlanHash, type PlanInput } from "./plan-hash";

/** Validated IDs only; all money/recipients come from authoritative obligations, never AI output. */
export function buildPlannerPlan(eligible:readonly Payable[],proposal:PlannerOutput,executionId:string,manualHolds:readonly string[]){
  const byId=new Map(eligible.map(o=>[o.id,o])),held=new Set([...proposal.holds.map(h=>h.obligationId),...manualHolds]);
  if([...held].some(id=>!byId.has(id)))throw new PlanError("UNKNOWN_HOLD","a held obligation is not part of this run");
  const plan:PlanInput={obligations:proposal.order.filter(id=>!held.has(id)).map(id=>{const o=byId.get(id);if(!o)throw new PlanError("UNKNOWN_HOLD","an obligation is not part of this run");return{id:o.id,amount:o.amount,recipient:o.recipient};}),heldIds:[...held].sort(),source:executionId};
  if(!plan.obligations.length)throw new PlanError("NOTHING_TO_PAY","every obligation is on hold; nothing to pay");
  const planHash=computePlanHash(plan);
  if(checkPlan(plan,planHash,eligible).length)throw new PlanError("UNKNOWN_HOLD","the planner did not account for every obligation exactly once");
  return{plan,planHash};
}
