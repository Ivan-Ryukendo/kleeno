import { guarded } from "@/server/auth/guard";
import { createObligations } from "@/server/db/approval";
import { uuid } from "@/server/schemas";

// Resume after a crash or after fixing a wallet: finishes the obligations of an already approved run. Grants no authority, so no re-auth.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) =>
  createObligations({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
