import { describe,expect,it } from "vitest";
import { checkStanding,type StandingInput } from "@/core/payments/batches/standing";
const clean=():StandingInput=>({standing:{id:"sa",companyId:"company",createdBy:"payer",maxBatchTotal:500n,maxPerPayment:500n,expiresAt:new Date("2030-01-01"),revokedAt:null},plan:{obligations:[{id:"o",amount:100n,recipient:"0x"+"a".repeat(40)}],heldIds:[],source:"execution"},signalCount:0,companyCeiling:500n,payrollApproverId:"payroll",now:new Date("2026-10-06"),companyId:"company",sameConfigVersion:true,recipientChanged:false,hasExistingHolds:false,creatorHasPaymentRole:true,livePaymentsEnabled:true});
describe("standing authorization fresh context",()=>{
  it("allows only clean matching-company context",()=>expect(checkStanding(clean())).toEqual([]));
  it("rejects grants above the exact JSON-safe money cap",()=>expect(checkStanding({...clean(),standing:{...clean().standing,maxBatchTotal:1_000_000_000_000_001n}})).toContain("OVER_AUTHORIZATION_CEILING"));
  it.each([["companyId","other","COMPANY_MISMATCH"],["sameConfigVersion",false,"CONFIG_VERSION_CHANGED"],["recipientChanged",true,"RECIPIENT_CHANGED"],["hasExistingHolds",true,"HAS_HOLDS"],["creatorHasPaymentRole",false,"CREATOR_ROLE_REMOVED"],["livePaymentsEnabled",false,"LIVE_PAYMENTS_OFF"]] as const)("refuses %s",(field,value,code)=>expect(checkStanding({...clean(),[field]:value})).toContain(code));
});
