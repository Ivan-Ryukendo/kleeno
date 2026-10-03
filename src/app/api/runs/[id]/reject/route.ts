import { guarded } from "@/server/auth/guard";
import { rejectRun } from "@/server/db/approval";
import { uuid } from "@/server/schemas";

// Rejecting only reduces authority, so no re-auth (rule 47). A rejected run is terminal: start a new run.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) => ({
  status: await rejectRun({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
}));
