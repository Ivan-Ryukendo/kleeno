import { z } from "zod";
import { normalizeEmail } from "@/core/growth";
import { openRoute } from "@/server/auth/guard";
import { AuthError, sessionClient } from "@/server/auth/session";
import { allow, clientKey, isPlatformAdmin, keyOf } from "@/server/db/growth";

const Body = z.object({ email: z.string().trim().max(254).pipe(z.email()), password: z.string().min(1).max(200) }).strict();

// Admin password step (S52), reachable only through the secret path. A wrong password and a non-admin account get the same reply.
export const POST = openRoute({ scope: "admin", body: Body }, async ({ body, jar, cookies, request }) => {
  const email = normalizeEmail(body.email);
  if (!(await allow("admin-login", clientKey(request), 900, 10)) || !(await allow("admin-login-email", keyOf(email), 900, 5)))
    throw new AuthError(429, "THROTTLED", "Too many attempts. Try again in 15 minutes.");
  const client = sessionClient(jar, cookies);
  const { data, error } = await client.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.user || !(await isPlatformAdmin(data.user.id))) {
    cookies.length = 0; // no session cookies unless this is an admin
    throw new AuthError(401, "UNAUTHENTICATED", "Invalid email or password");
  }
  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? []; // verified TOTP factors only
  return factors.length > 0 ? { next: "mfa", factorId: factors[0].id } : { next: "enrol" };
});
