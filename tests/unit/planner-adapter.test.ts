import { beforeEach,describe,expect,it,vi } from "vitest";
import { planPayments } from "@/server/ai/planner";
import type { AiProvider } from "@/core/ai";
const record=vi.hoisted(()=>vi.fn(async()=>"33333333-3333-4333-8333-333333333333"));
vi.mock("@/server/db/ai",()=>({recordExecution:record}));
vi.mock("@/server/ai/provider",()=>({defaultProvider:()=>{throw Error("tests inject their own provider");}}));
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const obs=[{id:A,amount:100n,recipient:"0x"+"a".repeat(40),workerRef:"W001"},{id:B,amount:200n,recipient:"0x"+"b".repeat(40),workerRef:"W002"}];
const who={companyId:A,correlationId:B};
const fake=(output:unknown):AiProvider=>({name:"fake",complete:async()=>({text:JSON.stringify(output),model:"fake"})});
describe("planner adapter audit/fallback",()=>{
 beforeEach(()=>record.mockClear());
 it("hydrates approved AI order and binds source to immutable execution ID",async()=>{const p=await planPayments(who,A,obs,[],1000n,[],fake({order:[B,A],holds:[],flags:[],rationale:"No fired signals."}));expect(p.plan.source).toBe(await record.mock.results[0].value);expect(p.plan.obligations.map(o=>o.id)).toEqual([B,A]);expect(record).toHaveBeenCalledOnce();});
 it.each(["provider","invalid"])("returns ordered FALLBACK when %s fails",async mode=>{const p=mode==="provider"?{name:"offline",complete:async()=>{throw Error("offline");}}:fake({order:[A],holds:[],flags:[],rationale:"Missing an obligation."});const result=await planPayments(who,A,[...obs].reverse(),[],1000n,[],p);expect(result.plan.source).toBe("FALLBACK");expect(result.plan.obligations).toEqual(obs.map(({id,amount,recipient})=>({id,amount,recipient})));expect(record).toHaveBeenCalledOnce();});
});
