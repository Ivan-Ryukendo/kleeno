import { guarded } from "@/server/auth/guard";
import { uuid } from "@/server/schemas";
import { executeBatch } from "@/server/payments/execute";

// Pays the signed batch through the gate. It stops after about 40 seconds and says how many remain: call it again to continue.
// Starting payments needs no new authority (the batch is already signed), and every payment still passes the gate.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYMENT_APPROVER"] }, async ({ actor, params, correlationId }) =>
  executeBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
