import "server-only";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { Role } from "@/core/workflow";
import { db } from "@/server/db/client";
import { env } from "@/server/env";

export type CookieJar = { name: string; value: string }[];
export type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 429,
    readonly code: "UNAUTHENTICATED" | "NO_ACCESS" | "MFA_REQUIRED" | "FORBIDDEN" | "THROTTLED",
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  email: string | null;
  companyId: string;
  role: Role;
  mfaRequired: boolean;
  aal: "aal1" | "aal2";
}

/** A Supabase client bound to the caller's cookies. With `sink`, refreshed/new session cookies are collected for the response. */
export function sessionClient(jar: CookieJar, sink?: PendingCookie[]) {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (list) => {
        for (const c of list) sink?.push({ name: c.name, value: c.value, options: c.options ?? {} });
      },
    },
  });
}

export const jarFromRequest = (request: Request): CookieJar =>
  parseCookieHeader(request.headers.get("cookie") ?? "").map((c) => ({ name: c.name, value: c.value ?? "" }));

/**
 * The one place a session becomes an Actor. Identity comes from Supabase (`getUser` re-validates the token);
 * company and role come only from app_users (rule 33), never from the request or user metadata.
 */
export async function authenticate(jar: CookieJar, opts: { allowAal1?: boolean; sink?: PendingCookie[] } = {}) {
  const client = sessionClient(jar, opts.sink);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  const row = (
    await db().from("app_users").select("company_id, role, email, companies(mfa_required)").eq("id", data.user.id).maybeSingle()
  ).data as { company_id: string; role: Role; email: string | null; companies: { mfa_required: boolean } | null } | null;
  if (!row || !row.companies) throw new AuthError(403, "NO_ACCESS", "this account has no company access");
  const { data: aalData } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = aalData?.currentLevel === "aal2" ? "aal2" : "aal1";
  // A user who has a verified factor always needs it, whatever the company flag says (a password alone must not suffice).
  const needsMfa = row.companies.mfa_required || aalData?.nextLevel === "aal2";
  if (needsMfa && aal !== "aal2" && !opts.allowAal1) throw new AuthError(401, "MFA_REQUIRED", "multi-factor sign-in required");
  const actor: Actor = { userId: data.user.id, email: row.email ?? data.user.email ?? null, companyId: row.company_id, role: row.role, mfaRequired: row.companies.mfa_required, aal };
  return { actor, client };
}
