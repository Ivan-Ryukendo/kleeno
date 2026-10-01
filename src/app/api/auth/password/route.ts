import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { assertNotThrottled, passwordIsValid, recordAuthEvent } from "@/server/auth/login";
import { AuthError } from "@/server/auth/session";

const Body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) }).strict();

export const POST = guarded({ body: Body }, async ({ actor, client, body, correlationId }) => {
  if (!actor.email) throw new AuthError(403, "FORBIDDEN", "account has no email");
  await assertNotThrottled(actor.companyId, actor.userId, "REAUTH_FAILED");
  if (!(await passwordIsValid(actor.email, body.currentPassword))) {
    await recordAuthEvent("REAUTH_FAILED", actor.companyId, actor.userId, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "Current password is wrong");
  }
  const { error } = await client.auth.updateUser({ password: body.newPassword });
  if (error) throw new AuthError(403, "FORBIDDEN", "New password was not accepted");
  await recordAuthEvent("PASSWORD_CHANGED", actor.companyId, actor.userId, correlationId);
  return { ok: true };
});
