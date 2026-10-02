import { z } from "zod";
import { openRoute } from "@/server/auth/guard";
import { clearCompanyCookie, companyCookie, COMPANY_COOKIE, readCompany } from "@/server/auth/company";
import { assertNotThrottled, recordAuthEvent } from "@/server/auth/login";
import { AuthError, sessionClient } from "@/server/auth/session";
import { db } from "@/server/db/client";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict();

type Row = { user_id: string; company_id: string; companies: { mfa_required: boolean } | null };

// Password sign-in. The reply says what is still needed: nothing, an MFA code, or MFA enrolment. A user with one company
// gets it as the active company; with several, the chooser (/select-company) asks (S61).
export const POST = openRoute({ body: Body }, async ({ body, jar, cookies, correlationId }) => {
  const email = body.email.toLowerCase();
  const rows = ((await db().from("memberships").select("user_id, company_id, companies(mfa_required)").eq("email", email).is("removed_at", null).order("created_at")).data ?? []) as unknown as Row[];
  const known = rows[0];
  if (known) await assertNotThrottled(known.company_id, known.user_id, "LOGIN_FAILED");

  const client = sessionClient(jar, cookies);
  const { data, error } = await client.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.user) {
    if (known) await recordAuthEvent("LOGIN_FAILED", known.company_id, known.user_id, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "Invalid email or password");
  }
  if (!known || known.user_id !== data.user.id) {
    cookies.length = 0; // no session cookies for an account without company access
    throw new AuthError(403, "NO_ACCESS", "this account has no company access");
  }
  await recordAuthEvent("LOGIN_OK", known.company_id, known.user_id, correlationId);

  const previous = readCompany(jar.find((c) => c.name === COMPANY_COOKIE)?.value);
  const active = rows.length === 1 ? rows[0].company_id : rows.find((r) => r.company_id === previous)?.company_id;
  cookies.push(active ? companyCookie(active) : clearCompanyCookie());

  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? []; // verified TOTP factors only
  if (factors.length > 0) return { next: "mfa", factorId: factors[0].id };
  return { next: rows.some((r) => r.companies?.mfa_required) ? "enrol" : "dashboard" };
});
