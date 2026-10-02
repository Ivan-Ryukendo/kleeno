import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { auditEvent } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { inviteExpiry, inviteStatus, type InviteStatus } from "@/core/invites";
import type { Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { writeAudit } from "./audit";
import { db, must } from "./client";

// Invites (S62). Only the SHA-256 of the token is stored; the plain token exists once, in the link handed to the sender.
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface IssueInput {
  companyId: string;
  email: string;
  roles: Role[];
  issuer: "PLATFORM" | "OWNER";
  issuedBy: string;
  leadId?: string;
  correlationId: string;
}

/** Creates the invite and returns its link token. A person who is already an active member cannot be invited again. */
export async function issueInvite(i: IssueInput): Promise<{ id: string; token: string; expiresAt: string }> {
  const userId = await userIdByEmail(i.email);
  if (userId) {
    const member = (await db().from("memberships").select("user_id").eq("company_id", i.companyId).eq("user_id", userId).is("removed_at", null).maybeSingle()).data;
    if (member) throw new WorkflowError("CONFLICT", "that person is already a member of this company");
  }
  // A re-invite replaces the pending one (the unique index allows a single pending invite per person and company).
  must(await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("company_id", i.companyId).eq("email", i.email).is("used_at", null).is("revoked_at", null).select("id"), "invite replace");
  const token = newToken();
  const expiresAt = inviteExpiry().toISOString();
  const row = must(
    await db()
      .from("invites")
      .insert({ company_id: i.companyId, email: i.email, roles: i.roles, issuer: i.issuer, issued_by: i.issuedBy, lead_id: i.leadId ?? null, token_hash: hashToken(token), expires_at: expiresAt })
      .select("id")
      .single(),
    "invite insert",
  );
  await writeAudit(auditEvent({ companyId: i.companyId, event: "invite.create", entityType: "invite", entityId: row.id, actor: i.issuedBy, actorType: "user", correlationId: i.correlationId, refs: { issuer: i.issuer, roles: i.roles.join(",") } }));
  return { id: row.id, token, expiresAt };
}

export interface InviteRow {
  id: string;
  email: string;
  roles: Role[];
  issuer: string;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

export async function listInvites(companyId: string): Promise<InviteRow[]> {
  const rows = must(await db().from("invites").select("id, email, roles, issuer, expires_at, used_at, revoked_at, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200), "invites read");
  return rows.map((r) => ({ id: r.id, email: r.email, roles: r.roles as Role[], issuer: r.issuer, status: inviteStatus({ expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at }), expiresAt: r.expires_at, createdAt: r.created_at }));
}

/** The waitlist contacts that already have a platform invite (pending or used), so approval is not repeated by accident. */
export async function leadInvites(leadId: string) {
  const rows = must(await db().from("invites").select("id, company_id, email, roles, used_at, revoked_at, expires_at, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }), "lead invites read");
  return rows.map((r) => ({ id: r.id, companyId: r.company_id as string, status: inviteStatus({ expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at }), createdAt: r.created_at as string }));
}

export async function revokeInvite(companyId: string, id: string, actorId: string, correlationId: string) {
  const rows = must(await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("company_id", companyId).is("used_at", null).is("revoked_at", null).select("id"), "invite revoke");
  if (rows.length === 0) throw new TransitionError("NOT_FOUND", "no pending invite found");
  await writeAudit(auditEvent({ companyId, event: "invite.revoke", entityType: "invite", entityId: id, actor: actorId, actorType: "user", correlationId }));
}

export interface InviteView {
  inviteId: string;
  companyId: string;
  companyName: string;
  email: string;
  roles: Role[];
  existingAccount: boolean;
}

/** The invite behind a link, only while it can still be accepted; null for every other case (S62: one reply for all of them). */
export async function peekInvite(token: string): Promise<InviteView | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const r = (await db().from("invites").select("id, company_id, email, roles, expires_at, used_at, revoked_at, companies(name)").eq("token_hash", hashToken(token)).maybeSingle()).data as {
    id: string; company_id: string; email: string; roles: Role[]; expires_at: string; used_at: string | null; revoked_at: string | null; companies: { name: string } | null;
  } | null;
  if (!r || !r.companies || inviteStatus({ expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at }) !== "PENDING") return null;
  return { inviteId: r.id, companyId: r.company_id, companyName: r.companies.name, email: r.email, roles: r.roles, existingAccount: !!(await userIdByEmail(r.email)) };
}

/** Burns the invite and creates the membership in one transaction. Null = it could not be accepted (any reason). */
export async function acceptInvite(token: string, userId: string, email: string): Promise<string | null> {
  const res = await db().rpc("accept_invite", { p_token_hash: hashToken(token), p_user: userId, p_email: email });
  if (res.error) throw new Error(`db invite accept failed (${res.error.code})`);
  return (res.data as string | null) ?? null;
}

export const userIdByEmail = async (email: string) => ((await db().rpc("auth_user_by_email", { p_email: email })).data as string | null) ?? null;
