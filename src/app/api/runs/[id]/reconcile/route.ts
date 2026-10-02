import { guarded } from "@/server/auth/guard";
import { reconcileRun } from "@/server/db/reconciliation";
import { uuid } from "@/server/schemas";

// No body: the action is the URL. Freezes the run's data, runs the deterministic checks and stores exceptions.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) =>
  reconcileRun({ companyId: actor.companyId, userId: actor.userId, role: actor.role, correlationId }, uuid.parse(params.id)),
);
