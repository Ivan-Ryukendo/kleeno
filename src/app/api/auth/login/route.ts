import { z } from "zod";
import { openRoute } from "@/server/auth/guard";
import { assertNotThrottled, recordAuthEvent } from "@/server/auth/login";
import { AuthError, sessionClient } from "@/server/auth/session";
import { db } from "@/server/db/client";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict();

// Password sign-in. The reply says what is still needed: nothing, an MFA code, or MFA enrolment.
export const POST = openRoute({ body: Body }, async ({ body, jar, cookies, correlationId }) => {
  const email = body.email.toLowerCase();
  const known = (await db().from("app_users").select("id, company_id, companies(mfa_required)").eq("email", email).maybeSingle()).data as { id: string; company_id: string; companies: { mfa_required: boolean } | null } | null;
  if (known) await assertNotThrottled(known.company_id, known.id, "LOGIN_FAILED");

  const client = sessionClient(jar, cookies);
  const { data, error } = await client.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.user) {
    if (known) await recordAuthEvent("LOGIN_FAILED", known.company_id, known.id, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "Invalid email or password");
  }
  if (!known || known.id !== data.user.id) {
    cookies.length = 0; // no session cookies for an account without company access
    throw new AuthError(403, "NO_ACCESS", "this account has no company access");
  }
  await recordAuthEvent("LOGIN_OK", known.company_id, known.id, correlationId);

  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? []; // verified TOTP factors only
  if (factors.length > 0) return { next: "mfa", factorId: factors[0].id };
  return { next: known.companies?.mfa_required ? "enrol" : "dashboard" };
});
