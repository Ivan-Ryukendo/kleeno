import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { proposeBatch } from "@/server/db/batches";
import { uuid } from "@/server/schemas";

// The payment approver chooses which obligations to hold; the plan itself is built by code (fallback plan; the AI Planner is P4b).
// Placing a hold only reduces authority, so no re-auth here. Releasing one takes effect only when the new batch is signed (S16).
const Body = z.object({ holdIds: z.array(uuid).max(500).default([]) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYMENT_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) =>
  proposeBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body.holdIds),
);
