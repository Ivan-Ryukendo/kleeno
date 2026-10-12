import "server-only";
import { runValidated, type AiProvider } from "@/core/ai";
import { plannerInput } from "@/core/ai/inputs/planner";
import { plannerSpec, PLANNER_PROMPT_VERSION, PLANNER_SCHEMA_VERSION } from "@/core/ai/planner";
import { buildFallbackPlan, type Payable } from "@/core/payments/batches";
import { buildPlannerPlan } from "@/core/payments/planner";
import type { Signal } from "@/core/payments/signals";
import { recordExecution } from "@/server/db/ai";
import { defaultProvider } from "./provider";

export async function planPayments(who:{companyId:string;correlationId:string},runId:string,obligations:readonly (Payable&{workerRef:string})[],signals:readonly Signal[],treasuryBalance:bigint,manualHolds:readonly string[],provider?:AiProvider){
  const fallback=buildFallbackPlan(obligations,manualHolds);
  const p=provider??defaultProvider(who.companyId);
  const result=await runValidated(p,plannerSpec(obligations,signals,treasuryBalance),plannerInput({obligations:obligations.map(({id,amount,workerRef})=>({id,amount:amount.toString(),workerRef})),signals,treasuryBalance:treasuryBalance.toString(),batchTotal:obligations.reduce((s,o)=>s+o.amount,0n).toString()},runId));
  const executionId=await recordExecution(who,{operation:"PAYMENT_PLAN",inputRef:runId,schemaVersion:PLANNER_SCHEMA_VERSION,promptVersion:PLANNER_PROMPT_VERSION,provider:p.name,telemetry:p.telemetry?.(),result});
  if(result.status==="NEEDS_HUMAN_REVIEW"||!result.output)return{...fallback,executionId,proposal:null};
  try{return{...buildPlannerPlan(obligations,result.output,executionId,manualHolds),executionId,proposal:result.output};}
  catch{return{...fallback,executionId,proposal:null};}
}
