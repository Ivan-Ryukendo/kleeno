import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auditEvent } from "@/core/audit";
import { writeAudit } from "@/server/db/audit";
import { db, must } from "@/server/db/client";
import { env } from "@/server/env";
import { AuthError } from "./session";

// Login and MFA failures are audited per company and rate-limited from the audit trail (S43).
// Unknown emails have no company to audit against; Supabase's own auth rate limits cover them.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export async function assertNotThrottled(companyId: string, userId: string, event: "LOGIN_FAILED" | "MFA_FAILED" | "REAUTH_FAILED") {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await db().from("audit_events").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("entity_id", userId).eq("event", event).gte("created_at", since);
  if (must({ data: count, error }, "auth throttle") >= MAX_FAILURES) throw new AuthError(429, "THROTTLED", "too many attempts; try again in a few minutes");
}

export function recordAuthEvent(event: string, companyId: string, userId: string, correlationId: string) {
  return writeAudit(auditEvent({ companyId, event, entityType: "user", entityId: userId, actor: userId, actorType: "user", correlationId }));
}

/** Re-authentication for actions that grant authority (rule 47): the password is checked in the same request, throttled and audited. */
export async function requireReauth(actor: { companyId: string; userId: string; email: string | null }, password: string | undefined, correlationId: string) {
  if (!actor.email || !password) throw new AuthError(401, "UNAUTHENTICATED", "Enter your password to confirm this");
  await assertNotThrottled(actor.companyId, actor.userId, "REAUTH_FAILED");
  if (!(await passwordIsValid(actor.email, password))) {
    await recordAuthEvent("REAUTH_FAILED", actor.companyId, actor.userId, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "That password is not right");
  }
}

/**
 * A fresh authenticator code, verified in the same request as the action (S66). Unlike a session at aal2, this proves the person is
 * holding the device now. Throttled and audited like every other MFA attempt.
 */
export async function requireTotp(client: SupabaseClient, actor: { companyId: string; userId: string }, code: string, correlationId: string) {
  await assertNotThrottled(actor.companyId, actor.userId, "MFA_FAILED");
  const factor = (await client.auth.mfa.listFactors()).data?.totp.find((f) => f.status === "verified");
  if (!factor) throw new AuthError(401, "MFA_REQUIRED", "set up an authenticator app on your account first", true);
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await recordAuthEvent("MFA_FAILED", actor.companyId, actor.userId, correlationId);
    throw new AuthError(401, "UNAUTHENTICATED", "That code is not valid");
  }
}

/** Checks a password without touching the caller's session (password change; P4 re-auth reuses it). */
export async function passwordIsValid(email: string, password: string): Promise<boolean> {
  const isolated = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await isolated.auth.signInWithPassword({ email, password });
  if (!error) await isolated.auth.signOut({ scope: "local" }); // local only: the default (global) would end the caller's own sessions too
  return !error && !!data.user;
}
