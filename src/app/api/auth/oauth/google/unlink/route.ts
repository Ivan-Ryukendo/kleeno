import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { recordAuthEvent, requireReauth } from "@/server/auth/login";
import { AuthError } from "@/server/auth/session";

const Body = z.object({ password: z.string().min(1).max(200) }).strict();

export const POST = guarded({ body: Body }, async ({ actor, client, body, correlationId }) => {
  const { data, error } = await client.auth.getUser();
  const user = data.user;
  if (error || !user || user.id !== actor.userId) throw new AuthError(401, "UNAUTHENTICATED", "Sign in again to confirm this.");
  const google = user.identities?.find((identity) => identity.provider === "google");
  if (!google) throw new AuthError(403, "FORBIDDEN", "Google is not linked to this account.");
  if (!user.email || !user.identities?.some((identity) => identity.provider === "email")) {
    throw new AuthError(403, "FORBIDDEN", "Keep Google linked until you have a working password sign-in method.");
  }
  // An email identity alone does not prove a password exists; re-auth must succeed before unlinking.
  await requireReauth({ ...actor, email: user.email }, body.password, correlationId);
  const { error: unlinkError } = await client.auth.unlinkIdentity(google);
  if (unlinkError) throw new AuthError(403, "FORBIDDEN", "Google could not be unlinked. It may be unavailable for this account. Try again or contact support.");
  await recordAuthEvent("GOOGLE_UNLINKED", actor.companyId, actor.userId, correlationId);
  return { ok: true };
});
