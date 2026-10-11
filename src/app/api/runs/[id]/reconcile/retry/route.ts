import { guarded } from "@/server/auth/guard";
import { retryReconciliation } from "@/server/db/reconciliation";
import { uuid } from "@/server/schemas";

// No body: resumes a run stranded in RECONCILING after a failed read. Same roles as the first pass; safe to repeat.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) =>
  retryReconciliation({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
