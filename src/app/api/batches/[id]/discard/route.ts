import { guarded } from "@/server/auth/guard";
import { discardBatch } from "@/server/db/batches";
import { uuid } from "@/server/schemas";

// Discarding an unsigned proposal only reduces authority: no re-auth.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYMENT_APPROVER"] }, async ({ actor, params, correlationId }) => ({
  status: await discardBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
}));
