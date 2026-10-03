import { guarded } from "@/server/auth/guard";
import { uuid } from "@/server/schemas";
import { closeBatch } from "@/server/payments/execute";

// Closing returns the unpaid balance from the guard; it only reduces authority, so no re-auth.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYMENT_APPROVER"] }, async ({ actor, params, correlationId }) =>
  closeBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
