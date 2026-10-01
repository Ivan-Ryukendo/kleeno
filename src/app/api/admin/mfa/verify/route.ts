import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { AuthError } from "@/server/auth/session";
import { allow, keyOf } from "@/server/db/growth";

const Body = z.object({ factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();

// Completes admin MFA sign-in or enrolment: the session upgrades to aal2.
export const POST = guarded({ scope: "admin", allowAal1: true, body: Body }, async ({ admin, client, body }) => {
  if (!(await allow("admin-mfa", keyOf(admin.userId), 900, 10))) throw new AuthError(429, "THROTTLED", "Too many attempts. Try again in 15 minutes.");
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: body.factorId, code: body.code });
  if (error) throw new AuthError(401, "UNAUTHENTICATED", "That code is not valid");
  return { ok: true };
});
