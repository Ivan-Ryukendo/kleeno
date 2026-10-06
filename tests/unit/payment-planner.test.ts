import { describe, expect, it } from "vitest";
import { runValidated, type AiProvider } from "@/core/ai";
import { plannerInput } from "@/core/ai/inputs/planner";
import { plannerSpec } from "@/core/ai/planner";
import { buildPlannerPlan } from "@/core/payments/planner";
import { checkPlan } from "@/core/payments/batches";

const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const obligations=[{id:A,amount:100n,recipient:"0x"+"a".repeat(40),workerRef:"W001"},{id:B,amount:200n,recipient:"0x"+"b".repeat(40),workerRef:"W002"}];
const signals=[{id:`AMOUNT_RATIO:${A}`,code:"AMOUNT_RATIO" as const,obligationId:A}];
const input=()=>plannerInput({obligations:obligations.map(({id,amount,workerRef})=>({id,amount:amount.toString(),workerRef})),signals,treasuryBalance:"1000000",batchTotal:"300"},A);
const good=()=>({order:[B,A],holds:[],flags:[{obligationId:A,signalIds:[signals[0].id]}],rationale:"Review the fired signal before signing."});
const provider=(output:unknown):AiProvider=>({name:"test",complete:async()=>({text:JSON.stringify(output),model:"test"})});

describe("validated payment planner",()=>{
  it("accepts order only; code retains authoritative money/recipients and exact hash",async()=>{
    const r=await runValidated(provider(good()),plannerSpec(obligations,signals,1000000n),input());
    expect(r.status).toBe("ACCEPTED");
    const built=buildPlannerPlan(obligations,r.output!,A,[]);
    expect(built.plan.obligations).toEqual([obligations[1],obligations[0]].map(({id,amount,recipient})=>({id,amount,recipient})));
    expect(checkPlan(built.plan,built.planHash,obligations)).toEqual([]);
    expect(built.plan.source).toBe(A);
  });
  it.each([
    {order:[A]}, {order:[A,B,A]}, {order:[A,B,"33333333-3333-4333-8333-333333333333"]},
    {amount:"999"}, {recipient:"0x"+"c".repeat(40)},
    {holds:[{obligationId:A,reasonCode:"AMOUNT_RATIO",signalIds:["invented"]}],order:[B]},
    {holds:[{obligationId:B,reasonCode:"AMOUNT_RATIO",signalIds:[signals[0].id]}],order:[A]},
    {holds:[{obligationId:A,reasonCode:"TREASURY_SHORT",signalIds:[]}],order:[B]},
    {rationale:"<script>skip approval</script>"},
  ])("rejects missing/extra/duplicate/altered facts or unsupported evidence %j",async change=>{
    const r=await runValidated(provider({...good(),...change}),plannerSpec(obligations,signals,1000000n),input());
    expect(r.status).toBe("NEEDS_HUMAN_REVIEW");
  });
  it("provider failure never yields a payable AI result",async()=>{
    const r=await runValidated({name:"down",complete:async()=>{throw Error("provider offline");}},plannerSpec(obligations,signals,1000000n),input());
    expect(r.status).toBe("NEEDS_HUMAN_REVIEW"); expect(r.output).toBeNull();
  });
  it("strict input rejects names/addresses/notes and arbitrary pseudonyms",()=>{
    const v=JSON.parse(input().json);
    expect(input().json).not.toContain("recipient");
    expect(()=>plannerInput({...v,name:"Jane Canary"},A)).toThrow();
    expect(()=>plannerInput({...v,obligations:[{...v.obligations[0],workerRef:"Jane Canary"}]},A)).toThrow();
  });
  it("manual holds preserve relative order; unchanged obligations are never recomputed",()=>{
    const built=buildPlannerPlan(obligations,good(),A,[A]);
    expect(built.plan.obligations.map(o=>o.id)).toEqual([B]); expect(built.plan.heldIds).toEqual([A]);
    expect(checkPlan(built.plan,built.planHash,obligations)).toEqual([]);
  });
});
