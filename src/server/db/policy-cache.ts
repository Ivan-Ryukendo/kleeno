import "server-only";
import { randomUUID } from "node:crypto";
import type { AiResult } from "@/core/ai";
import type { PolicyOutput } from "@/core/ai/policy";
import { proposalCacheKey, duplicatePolicyWarnings, type ProposalCacheContext } from "@/core/ai/cache";
import type { Clauses } from "@/core/config";
import { openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";

export async function loadPolicyProposal(context: ProposalCacheContext) {
  const row = (await db().from("policy_proposal_cache").select("id,payload_enc,execution_id,model").eq("company_id", context.companyId).eq("cache_key", proposalCacheKey(context)).eq("clause_hash", context.clauseHash).eq("provider", context.provider).eq("prompt_version", context.promptVersion).eq("schema_version", context.schemaVersion).in("model", [...context.models]).maybeSingle()).data;
  if (!row) return null;
  return { executionId: row.execution_id as string, result: await openJson<AiResult<PolicyOutput>>(context.companyId, "policy_proposal_cache", "payload_enc", row.id, row.payload_enc) };
}
export async function savePolicyProposal(context: ProposalCacheContext, executionId: string, result: AiResult<PolicyOutput>) {
  if (!result.output || result.status === "NEEDS_HUMAN_REVIEW" || !result.model || !context.models.includes(result.model)) return;
  const id = randomUUID(), payload_enc = await sealJson(context.companyId, "policy_proposal_cache", "payload_enc", id, result);
  must(await db().from("policy_proposal_cache").upsert({ id, company_id: context.companyId, cache_key: proposalCacheKey(context), clause_hash: context.clauseHash, provider: context.provider, model: result.model, prompt_version: context.promptVersion, schema_version: context.schemaVersion, execution_id: executionId, payload_enc }, { onConflict: "company_id,cache_key", ignoreDuplicates: true }).select("id"), "policy cache save");
}
/** Tenant predicate is applied before the recent-candidate bound. Nothing searchable stores plaintext clauses. */
export async function policyDuplicateWarnings(companyId: string, clauses: Clauses) {
  const rows = must(await db().from("payroll_configurations").select("id,version,clauses_enc").eq("company_id", companyId).order("version", { ascending: false }).limit(20), "duplicate candidates");
  const candidates = await Promise.all(rows.map(async r => ({ version: r.version, clauses: await openJson<Clauses>(companyId, "payroll_configurations", "clauses_enc", r.id, r.clauses_enc) })));
  return duplicatePolicyWarnings(clauses, candidates);
}
