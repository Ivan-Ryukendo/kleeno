import "server-only";
import { createClient } from "@supabase/supabase-js";
import { auditEvent } from "@/core/audit";
import { writeAudit } from "@/server/db/audit";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { AuthError } from "./session";

// Login and MFA failures are audited per company and rate-limited from the audit trail (S43).
// Unknown emails have no company to audit against; Supabase's own auth rate limits cover them.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export async function assertNotThrottled(companyId: string, userId: string, event: "LOGIN_FAILED" | "MFA_FAILED" | "REAUTH_FAILED") {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await db().from("audit_events").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("entity_id", userId).eq("event", event).gte("created_at", since);
  if ((count ?? 0) >= MAX_FAILURES) throw new AuthError(429, "THROTTLED", "too many attempts; try again in a few minutes");
}

export function recordAuthEvent(event: string, companyId: string, userId: string, correlationId: string) {
  return writeAudit(auditEvent({ companyId, event, entityType: "user", entityId: userId, actor: userId, actorType: "user", correlationId }));
}

/** Checks a password without touching the caller's session (password change; P4 re-auth reuses it). */
export async function passwordIsValid(email: string, password: string): Promise<boolean> {
  const isolated = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await isolated.auth.signInWithPassword({ email, password });
  if (!error) await isolated.auth.signOut({ scope: "local" }); // local only: the default (global) would end the caller's own sessions too
  return !error && !!data.user;
}
