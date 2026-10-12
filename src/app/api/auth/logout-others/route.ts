import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { recordAuthEvent } from "@/server/auth/login";
import { AuthError } from "@/server/auth/session";

export const POST = guarded({ scope: "app", body: z.object({}).strict() }, async ({ actor, client, correlationId }) => {
  const { error } = await client.auth.signOut({ scope: "others" });
  if (error) throw new AuthError(403, "FORBIDDEN", "Other sessions could not be signed out. Try again.");
  await recordAuthEvent("OTHER_SESSIONS_SIGNED_OUT", actor.companyId, actor.userId, correlationId);
  return { ok: true };
});
