import { guarded } from "@/server/auth/guard";
import { AuthError } from "@/server/auth/session";

// Admins always need TOTP. Someone with a verified factor must use it first, so a stolen password cannot enrol a new device.
export const POST = guarded({ scope: "admin", allowAal1: true }, async ({ client }) => {
  const { data: level } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") throw new AuthError(401, "MFA_REQUIRED", "verify your existing authenticator first");
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `kleeno-admin-${Date.now()}` });
  if (error || !data) throw new AuthError(403, "FORBIDDEN", "could not start MFA enrolment");
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
});
