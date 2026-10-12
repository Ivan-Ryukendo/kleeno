import "server-only";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { Role } from "@/core/tenancy";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { COMPANY_COOKIE, COMPANY_HEADER, readCompany } from "./company";

export type CookieJar = { name: string; value: string }[];
export type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 429,
    readonly code: "UNAUTHENTICATED" | "NO_ACCESS" | "NO_COMPANY" | "MFA_REQUIRED" | "FORBIDDEN" | "THROTTLED",
    message: string,
    readonly enrol = false, // MFA_REQUIRED only: the user has no second step yet and must set one up
  ) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  email: string | null;
  companyId: string;
  roles: readonly Role[];
  mfaRequired: boolean;
  aal: "aal1" | "aal2";
}

/** One company a user belongs to (the switcher list). */
export interface Membership {
  companyId: string;
  name: string;
  roles: Role[];
  mfaRequired: boolean;
}

/** A Supabase client bound to the caller's cookies. With `sink`, refreshed/new session cookies are collected for the response.
 *  With `companyId`, RLS sees that company as the active one (only if the user is a member; S61). */
export function sessionClient(jar: CookieJar, sink?: PendingCookie[], companyId?: string) {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: companyId ? { headers: { [COMPANY_HEADER]: companyId } } : undefined,
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

interface MembershipRow {
  company_id: string;
  roles: Role[];
  email: string | null;
  companies: { name: string; mfa_required: boolean } | null;
}

async function membershipsOf(userId: string): Promise<MembershipRow[]> {
  const { data } = await db().from("memberships").select("company_id, roles, email, companies(name, mfa_required)").eq("user_id", userId).is("removed_at", null).order("created_at").order("company_id");
  return ((data ?? []) as unknown as MembershipRow[]).filter((r) => r.companies);
}

const asMembership = (r: MembershipRow): Membership => ({ companyId: r.company_id, name: r.companies!.name, roles: r.roles, mfaRequired: r.companies!.mfa_required });

/**
 * The one place a session becomes an Actor. Identity comes from Supabase (`getUser` re-validates the token); company and
 * roles come only from `memberships` (rule 33, S61), never from the request or user metadata. The active company is the
 * signed cookie's value if the user is still a member; a user with one company needs no cookie; with several and no valid
 * cookie the call fails with NO_COMPANY (pages send the user to the company chooser). `allowAal1` (account steps such as
 * MFA and logout) falls back to the oldest membership, only so those steps can be audited.
 */
export async function authenticate(jar: CookieJar, opts: { allowAal1?: boolean; sink?: PendingCookie[] } = {}) {
  const claimed = readCompany(jar.find((c) => c.name === COMPANY_COOKIE)?.value);
  const client = sessionClient(jar, opts.sink, claimed && claimed !== "forged" ? claimed : undefined);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  const rows = await membershipsOf(data.user.id);
  if (rows.length === 0) throw new AuthError(403, "NO_ACCESS", "this account has no company access");

  let row = claimed && claimed !== "forged" ? rows.find((r) => r.company_id === claimed) : rows.length === 1 && !claimed ? rows[0] : undefined;
  if (!row) {
    if (!opts.allowAal1) throw new AuthError(403, "NO_COMPANY", "choose a company");
    row = rows[0];
  }
  const company = row.companies!;
  const { data: aalData, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || !aalData?.currentLevel) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  const aal = aalData?.currentLevel === "aal2" ? "aal2" : "aal1";
  // A user who has a verified factor always needs it, whatever the company flag says (a password alone must not suffice).
  const needsMfa = company.mfa_required || aalData?.nextLevel === "aal2";
  if (needsMfa && aal !== "aal2" && !opts.allowAal1) throw new AuthError(401, "MFA_REQUIRED", "multi-factor sign-in required", aalData?.nextLevel !== "aal2");
  const actor: Actor = { userId: data.user.id, email: row.email ?? data.user.email ?? null, companyId: row.company_id, roles: row.roles, mfaRequired: company.mfa_required, aal };
  return { actor, client, companies: rows.map(asMembership) };
}

/** A signed-in user who may not have chosen a company yet (the chooser page and the switch route). */
export async function authenticateUser(jar: CookieJar, opts: { sink?: PendingCookie[] } = {}) {
  const client = sessionClient(jar, opts.sink);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  const rows = await membershipsOf(data.user.id);
  if (rows.length === 0) throw new AuthError(403, "NO_ACCESS", "this account has no company access");
  const { data: aalData, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || !aalData?.currentLevel) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  const aal = aalData?.currentLevel === "aal2" ? "aal2" : "aal1";
  return { userId: data.user.id, client, aal, nextLevel: aalData?.nextLevel ?? "aal1", companies: rows.map(asMembership) };
}
