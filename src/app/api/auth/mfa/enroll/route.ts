import { guarded } from "@/server/auth/guard";
import { AuthError } from "@/server/auth/session";

// Starts TOTP enrolment; the factor counts only after /api/auth/mfa/verify succeeds with a code.
export const POST = guarded({ allowAal1: true }, async ({ client }) => {
  // Someone who already has a verified factor must prove it first; otherwise a stolen password could enrol an attacker's device.
  const { data: level, error: levelError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelError || !level?.currentLevel) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") throw new AuthError(401, "MFA_REQUIRED", "verify your existing authenticator first");
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `kleeno-${Date.now()}` });
  if (error || !data) throw new AuthError(403, "FORBIDDEN", "could not start MFA enrolment");
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
});
