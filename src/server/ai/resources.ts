import "server-only";
import { runValidated, type AiProvider } from "@/core/ai";
import { resourcePolicyInput } from "@/core/ai/inputs/resources";
import { resourcePolicySpec, RESOURCE_PROMPT_VERSION, RESOURCE_SCHEMA_VERSION } from "@/core/ai/resources";
import { canonicalHash } from "@/core/canonical";
import { ViewError } from "@/core/views";
import type { Role } from "@/core/tenancy";
import { hasRole } from "@/core/tenancy";
import { loadConfig } from "@/server/db/configs";
import { recordExecution } from "@/server/db/ai";
import { defaultProvider } from "./provider";

export async function proposeResourceColumns(who: { companyId: string; userId: string; roles: readonly Role[]; correlationId: string }, configVersion: number, provider: AiProvider = defaultProvider()) {
  if (!hasRole(who.roles, "HR_APPROVER", "PAYROLL_APPROVER")) throw new ViewError("HR review required");
  const config = await loadConfig(who.companyId, configVersion);
  if (!config || !["APPROVED", "ACTIVE", "SUPERSEDED"].includes(config.status)) throw new ViewError("approved policy version required");
  const ref = canonicalHash({ configVersion, clauses: config.clauses });
  const result = await runValidated(provider, resourcePolicySpec(config.clauses, configVersion), resourcePolicyInput(config.clauses, configVersion, ref));
  // Resource labels and policy details stay out of plaintext AIExecution output; retain hashes and source references.
  const logged = { ...result, output: result.output ? { outcome: result.output.outcome, proposals: result.output.columns.map((d) => ({ hash: canonicalHash(d), kind: d.rule.kind, configVersion, clauseIds: d.policy?.clauseIds ?? [] })) } : null };
  const executionId = await recordExecution(who, { operation: "POLICY_INTERPRET", inputRef: ref, schemaVersion: RESOURCE_SCHEMA_VERSION, promptVersion: RESOURCE_PROMPT_VERSION, provider: provider.name, result: logged });
  return { status: result.status, executionId, proposals: result.status === "NEEDS_HUMAN_REVIEW" ? [] : result.output?.columns ?? [], problems: result.problems, flags: result.flags };
}
