import { guarded } from "@/server/auth/guard";
import { submitRun } from "@/server/db/approval";
import { uuid } from "@/server/schemas";

// No body: the action is the URL. SIMULATION runs are refused by the state machine and a DB CHECK (rule 17).
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) => ({
  status: await submitRun({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
}));
