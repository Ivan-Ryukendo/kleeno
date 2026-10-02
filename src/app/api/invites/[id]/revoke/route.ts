import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { revokeInvite } from "@/server/db/invites";

export const POST = guarded<undefined, { id: string }>({ roles: ["OWNER"] }, async ({ actor, params, correlationId }) => {
  await revokeInvite(actor.companyId, z.uuid().parse(params.id), actor.userId, correlationId);
  return { ok: true };
});
