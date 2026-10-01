import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { assertNotThrottled, recordAuthEvent } from "@/server/auth/login";
import { AuthError } from "@/server/auth/session";

const Body = z.object({ factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();

// Completes MFA sign-in or enrolment: on success the session cookie upgrades to aal2.
export const POST = guarded({ allowAal1: true, body: Body }, async ({ actor, client, body, correlationId }) => {
  await assertNotThrottled(actor.companyId, actor.userId, "MFA_FAILED");
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: body.factorId, code: body.code });
  if (error) {
    await recordAuthEvent("MFA_FAILED", actor.companyId, actor.userId, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "That code is not valid");
  }
  await recordAuthEvent("MFA_OK", actor.companyId, actor.userId, correlationId);
  return { ok: true };
});
