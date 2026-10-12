import "server-only";
import { runValidated, type AiProvider, type AiResult } from "@/core/ai";
import { policyInput } from "@/core/ai/inputs/policy";
import { POLICY_PROMPT_VERSION, POLICY_SCHEMA_VERSION, policySpec, PolicyOutputSchema, type PolicyOutput } from "@/core/ai/policy";
import { canonicalHash } from "@/core/canonical";
import { splitPolicy, validatedPolicyDocuments, type PolicyDocuments } from "@/core/config";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { recordExecution } from "@/server/db/ai";
import { advanceAiConfig, createConfigDraft } from "@/server/db/configs";
import { defaultProvider } from "./provider";
import { loadPolicyProposal, savePolicyProposal, policyDuplicateWarnings } from "@/server/db/policy-cache";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId: string;
}

/** Policy text -> clauses -> AI proposal -> validate/repair -> AIExecution -> config in HUMAN_REVIEW (never approved by AI, rule 2). */
export async function proposeConfig(who: Who, policyText: string, provider: AiProvider = defaultProvider(who.companyId), documents: PolicyDocuments = []) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side edits configuration");
  const clauses = documents.length ? validatedPolicyDocuments(policyText, documents).clauses : splitPolicy(policyText);
  const ref = canonicalHash(clauses);
  const spec = policySpec(clauses);
  const context = { companyId: who.companyId, clauseHash: ref, provider: provider.name, models: provider.models ?? [], promptVersion: POLICY_PROMPT_VERSION, schemaVersion: POLICY_SCHEMA_VERSION };
  const cached = context.models.length ? await loadPolicyProposal(context) : null;
  let result: AiResult<PolicyOutput> | null = null;
  let cacheHit = false;
  if (cached) {
    const shaped = PolicyOutputSchema.safeParse(cached.result.output);
    if (shaped.success && !spec.declined?.(shaped.data)) {
      const checked = spec.check(shaped.data);
      if (!checked.problems.length && cached.result.model && context.models.includes(cached.result.model)) { result = { ...cached.result, output: shaped.data, problems: [], flags: checked.flags, repairs: [], retries: 0 }; cacheHit = true; }
    }
  }
  result ??= await runValidated(provider, spec, policyInput(clauses, ref));
  const executionId = await recordExecution(who, { operation: "POLICY_INTERPRET", inputRef: ref, schemaVersion: POLICY_SCHEMA_VERSION, promptVersion: POLICY_PROMPT_VERSION, provider: provider.name, telemetry: provider.telemetry?.(), result, ...(cached && cacheHit ? { cacheExecutionId: cached.executionId } : {}) });
  if (result.status === "NEEDS_HUMAN_REVIEW" || !result.output?.params) return { status: result.status, executionId, problems: result.problems, config: null };
  if (!cached && context.models.length) await savePolicyProposal(context, executionId, result);
  const warnings = await policyDuplicateWarnings(who.companyId, clauses);
  const draft = await createConfigDraft(who, { params: result.output.params, clauses, documents, warnings, ai: { executionId, flags: result.flags } });
  await advanceAiConfig(who, draft.id);
  return { status: result.status, executionId, problems: [], flags: result.flags, warnings, cacheHit, config: draft };
}
