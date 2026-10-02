import "server-only";
import { runValidated, type AiProvider } from "@/core/ai";
import { policyInput } from "@/core/ai/inputs/policy";
import { POLICY_PROMPT_VERSION, POLICY_SCHEMA_VERSION, policySpec } from "@/core/ai/policy";
import { canonicalHash } from "@/core/canonical";
import { splitPolicy } from "@/core/config";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { recordExecution } from "@/server/db/ai";
import { advanceAiConfig, createConfigDraft } from "@/server/db/configs";
import { defaultProvider } from "./provider";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId: string;
}

/** Policy text -> clauses -> AI proposal -> validate/repair -> AIExecution -> config in HUMAN_REVIEW (never approved by AI, rule 2). */
export async function proposeConfig(who: Who, policyText: string, provider: AiProvider = defaultProvider()) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side edits configuration");
  const clauses = splitPolicy(policyText);
  const ref = canonicalHash(clauses);
  const result = await runValidated(provider, policySpec(clauses), policyInput(clauses, ref));
  const executionId = await recordExecution(who, { operation: "POLICY_INTERPRET", inputRef: ref, schemaVersion: POLICY_SCHEMA_VERSION, promptVersion: POLICY_PROMPT_VERSION, provider: provider.name, result });
  if (result.status === "NEEDS_HUMAN_REVIEW" || !result.output?.params) return { status: result.status, executionId, problems: result.problems, config: null };
  const draft = await createConfigDraft(who, { params: result.output.params, clauses, ai: { executionId, flags: result.flags } });
  await advanceAiConfig(who, draft.id);
  return { status: result.status, executionId, problems: [], flags: result.flags, config: draft };
}
