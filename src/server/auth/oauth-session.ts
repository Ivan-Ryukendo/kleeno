import "server-only";
import { auditEvent } from "@/core/audit";
import { writeAudit } from "@/server/db/audit";
import { db } from "@/server/db/client";
import { logEvent, logError } from "@/server/log";
import { clearCompanyCookie, companyCookie, COMPANY_COOKIE, readCompany } from "./company";
import { clearOauthNextCookie, completeCallback, OAUTH_NEXT_COOKIE, type CallbackDeps, type CallbackResult } from "./oauth";
import { sessionClient, type CookieJar, type PendingCookie } from "./session";

// The real ports for the Google callback. Session cookies land in `cookies` (the route puts them on the redirect).
export function callbackDeps(jar: CookieJar, cookies: PendingCookie[], correlationId: string): CallbackDeps {
  const client = sessionClient(jar, cookies);
  return {
    exchange: async (code) => {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      return error || !data.user ? null : data.user.id;
    },
    memberships: async (userId) => {
      const { data } = await db().from("memberships").select("company_id, companies(mfa_required)").eq("user_id", userId).is("removed_at", null).order("created_at").order("company_id");
      return ((data ?? []) as unknown as { company_id: string; companies: { mfa_required: boolean } | null }[]).filter((r) => r.companies).map((r) => ({ companyId: r.company_id, mfaRequired: r.companies!.mfa_required }));
    },
    verifiedFactor: async () => (await client.auth.mfa.listFactors()).data?.totp[0]?.id ?? null, // listFactors' `totp` holds verified factors only
    signOut: async () => {
      const { error } = await client.auth.signOut({ scope: "local" }); // local: the user's password session elsewhere must survive
      if (error) logError("oauth", correlationId, error);
    },
    audit: (event, companyId, userId) => writeAudit(auditEvent({ companyId, event, entityType: "user", entityId: userId, actor: userId, actorType: "user", correlationId, refs: { provider: "google" } })),
    log: (event, refs) => logEvent("auth", event, { correlationId, ...refs }),
  };
}

/** The whole callback for a request: query params in, a redirect target and cookies out. */
export async function handleCallback(request: Request, jar: CookieJar, cookies: PendingCookie[], correlationId: string): Promise<CallbackResult> {
  const q = new URL(request.url).searchParams; // only `code` and `error`: the destination is not taken from the URL
  try {
    const result = await completeCallback(callbackDeps(jar, cookies, correlationId), {
      code: q.get("code"),
      providerError: q.has("error"),
      next: jar.find((c) => c.name === OAUTH_NEXT_COOKIE)?.value ?? null, // checked by safeNext inside completeCallback
      previousCompany: readCompany(jar.find((c) => c.name === COMPANY_COOKIE)?.value),
    });
    if (result.company !== undefined) cookies.push(result.company ? companyCookie(result.company) : clearCompanyCookie());
    cookies.push(clearOauthNextCookie()); // single use: cleared on every outcome
    return result;
  } catch (err) {
    logError("oauth", correlationId, err);
    cookies.length = 0; // an unexpected failure must not leave a half-checked session behind
    cookies.push(clearOauthNextCookie());
    return { to: "/login?error=oauth", company: undefined };
  }
}
