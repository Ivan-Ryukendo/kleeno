import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { proposeBatch } from "@/server/db/batches";
import { uuid } from "@/server/schemas";

// The validated planner proposes IDs only; code binds unchanged values. Fallback always needs a human signature.
// Placing a hold only reduces authority, so no re-auth here. Releasing one takes effect only when the new batch is signed (S16).
const Body = z.object({ holdIds: z.array(uuid).max(500).default([]), planner: z.boolean().default(true) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYMENT_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) =>
  proposeBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body.holdIds, { planner: body.planner, autoAuthorize: body.planner }),
);
