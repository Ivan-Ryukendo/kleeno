import { guarded } from "@/server/auth/guard";
import { openBatch } from "@/server/db/batches";
import { uuid } from "@/server/schemas";

// Resume opening a signed batch on the guard after a failure. It adds no authority, so no re-auth; it never signs.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYMENT_APPROVER"] }, async ({ actor, params, correlationId }) =>
  openBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
