import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { reviewReadiness } from "./review-readiness";
import { loadPayrollReview } from "./payroll-review";

/** Dashboard evidence without loading historical payroll lines. */
export async function reviewerSummary(client: SupabaseClient, actor: { companyId: string; roles: readonly Role[] }, runId: string) {
  if (!isPayrollRole(actor.roles) && !isPaymentRole(actor.roles)) throw new WorkflowError("FORBIDDEN", "Your role cannot inspect review calculations");
  const [readiness, review] = await Promise.all([
    reviewReadiness(client, actor.companyId, runId),
    loadPayrollReview(client, actor.companyId, runId),
  ]);
  return { ...readiness, review, canReview: isPayrollRole(actor.roles) };
}
