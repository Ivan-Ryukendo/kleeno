import "server-only";
import type { User } from "@supabase/supabase-js";

// Google sign-in (P4g, S74). This file is pure on purpose: the redirect allow-list, the linked-method helpers and the callback
// decision logic take ports, so they run in unit tests without Supabase or Google. The real ports are in ./oauth-session.ts.
// Supabase only authenticates; `memberships` alone grants access (rule 55), so every check below is about who the session is.

export const HOME = "/dashboard";

// The only places a sign-in may send the user. Exact relative app paths: no query, no fragment, no encoding, no host.
// Anything else (absolute URL, `//host`, `/\host`, `%2f%2f`, `javascript:`) falls back to HOME, so there is no open redirect.
const NEXT_ALLOWED = /^\/(?:dashboard|workers|import|configuration|exceptions|settlement|account|select-company|onboarding|settings\/(?:company|team)|runs\/[A-Za-z0-9_-]{1,64})$/;

export function safeNext(next: string | null | undefined): string {
  return typeof next === "string" && next.length <= 100 && NEXT_ALLOWED.test(next) ? next : HOME;
}

// Supabase matches `redirectTo` against its Redirect URLs allow-list, so it carries no query. The destination travels in a short-lived
// httpOnly cookie instead (the route sets httpOnly + SameSite=lax on every cookie it pushes) and is checked again when it is read.
export const oauthRedirectTo = (origin: string) => `${origin}/auth/callback`;
export const OAUTH_NEXT_COOKIE = "kleeno-oauth-next";
export const oauthNextCookie = (next: string | null | undefined) => ({ name: OAUTH_NEXT_COOKIE, value: safeNext(next), options: { path: "/", maxAge: 600 } });
export const clearOauthNextCookie = () => ({ name: OAUTH_NEXT_COOKIE, value: "", options: { path: "/", maxAge: 0 } });

/** Sign-in methods linked to an account (the /account page). Supabase calls the password identity "email". */
export function linkedMethods(user: Pick<User, "identities" | "app_metadata">): ("password" | "google")[] {
  const providers = new Set(user.identities?.map((i) => i.provider) ?? (user.app_metadata?.providers as string[] | undefined) ?? []);
  return (["password", "google"] as const).filter((m) => providers.has(m === "password" ? "email" : m));
}

/** Method names from a session's `amr` claim, which Supabase returns as strings or as `{ method }` objects. */
export function amrMethods(amr: readonly (string | { method: string })[] | undefined): string[] {
  return (amr ?? []).map((a) => (typeof a === "string" ? a : a.method));
}

export interface CallbackDeps {
  /** Exchanges the PKCE code for a session (stored in the response cookies). The new user's ID, or null if the code failed, expired or was used. */
  exchange(code: string): Promise<string | null>;
  memberships(userId: string): Promise<{ companyId: string; mfaRequired: boolean }[]>;
  /** The user's verified TOTP factor, if any. */
  verifiedFactor(): Promise<string | null>;
  /** Ends only this session (not the user's other sessions) and clears its cookies. */
  signOut(): Promise<void>;
  audit(event: string, companyId: string, userId: string): Promise<void>;
  /** Redacting logger: references only, never tokens or profile data (S45). */
  log(event: string, refs: Record<string, string | number | boolean>): void;
}

export interface CallbackResult {
  to: string; // a relative path
  company: string | null | undefined; // active-company cookie: an ID to set, null to clear, undefined to leave alone
}

/**
 * The callback checks, in order (docs/phases/P4g.md): failed or reused code -> /login?error=oauth; no membership -> signed out,
 * /login?error=no-access; MFA exactly as for passwords (a verified factor -> the MFA step, an mfa_required company with no factor
 * -> enrol on /account; the session stays aal1 and every page re-checks aal2); otherwise the allow-listed destination.
 */
export async function completeCallback(
  deps: CallbackDeps,
  input: { code: string | null; providerError: boolean; next: string | null; previousCompany: string | null | "forged" },
): Promise<CallbackResult> {
  const fail = (to: string, reason: string) => {
    deps.log("oauth.failed", { reason });
    return { to, company: undefined };
  };
  if (!input.code || input.providerError) return fail("/login?error=oauth", "no_code");
  const userId = await deps.exchange(input.code).catch(() => null);
  if (!userId) return fail("/login?error=oauth", "exchange");

  const rows = await deps.memberships(userId);
  if (rows.length === 0) {
    await deps.signOut().catch(() => undefined); // the cookies must not outlive a refusal; a failed revoke is logged by the port
    return fail("/login?error=no-access", "no_membership"); // no company to audit against, so the log line carries the correlation ID
  }

  const previous = rows.find((r) => r.companyId === input.previousCompany)?.companyId;
  const active = rows.length === 1 ? rows[0].companyId : previous;
  await deps.audit("OAUTH_LOGIN_OK", active ?? rows[0].companyId, userId);
  deps.log("oauth.ok", { companies: rows.length });

  const next = safeNext(input.next);
  const factor = await deps.verifiedFactor();
  if (factor) return { to: `/login?step=mfa&factor=${factor}&next=${encodeURIComponent(next)}`, company: active ?? null };
  if (rows.some((r) => r.mfaRequired)) return { to: "/account", company: active ?? null };
  return { to: active ? next : "/select-company", company: active ?? null };
}
