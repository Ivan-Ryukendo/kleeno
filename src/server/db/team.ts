import "server-only";
import { auditEvent } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { keepsAnOwner, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { writeAudit } from "./audit";
import { db, must } from "./client";

export interface Member {
  userId: string;
  email: string | null;
  roles: Role[];
  joinedAt: string;
}

export async function listMembers(companyId: string): Promise<Member[]> {
  const rows = must(await db().from("memberships").select("user_id, email, roles, created_at").eq("company_id", companyId).is("removed_at", null).order("created_at").order("user_id"), "members read");
  return rows.map((r) => ({ userId: r.user_id, email: r.email, roles: r.roles as Role[], joinedAt: r.created_at }));
}

interface Who {
  companyId: string;
  userId: string;
  correlationId: string;
}

const lastOwner = () => new WorkflowError("CONFLICT", "a company needs at least one Owner");

/** Replaces a member's roles. The caller has already checked authority and re-authentication; the DB trigger still guards the last Owner. */
export async function changeRoles(who: Who, target: string, next: Role[]): Promise<{ from: Role[]; to: Role[] }> {
  if (target === who.userId) throw new WorkflowError("FORBIDDEN", "you cannot change your own roles");
  const members = await listMembers(who.companyId);
  const current = members.find((m) => m.userId === target);
  if (!current) throw new TransitionError("NOT_FOUND", "no such member");
  if (!keepsAnOwner(members, target, next)) throw lastOwner();
  const res = await db().from("memberships").update({ roles: next }).eq("company_id", who.companyId).eq("user_id", target).is("removed_at", null).filter("roles", "eq", `{${current.roles.join(",")}}`).select("user_id"); // compare-and-set on the roles we read
  if (res.error) throw res.error.message.includes("at least one Owner") ? lastOwner() : new Error(`db member update failed (${res.error.code})`);
  if (res.data.length === 0) throw new WorkflowError("CONFLICT", "this member changed meanwhile; reload and try again");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "member.roles", entityType: "user", entityId: target, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { from: current.roles.join(","), to: next.join(",") } }));
  return { from: current.roles, to: next };
}

/** Soft removal: access ends at the next request; approvals and audit rows that name the member stay valid. */
export async function removeMember(who: Who, target: string) {
  if (target === who.userId) throw new WorkflowError("FORBIDDEN", "you cannot remove yourself");
  const members = await listMembers(who.companyId);
  if (!members.some((m) => m.userId === target)) throw new TransitionError("NOT_FOUND", "no such member");
  if (!keepsAnOwner(members, target, null)) throw lastOwner();
  const res = await db().from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", who.companyId).eq("user_id", target).is("removed_at", null).select("user_id");
  if (res.error) throw res.error.message.includes("at least one Owner") ? lastOwner() : new Error(`db member remove failed (${res.error.code})`);
  if (res.data.length === 0) throw new TransitionError("NOT_FOUND", "no such member");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "member.remove", entityType: "user", entityId: target, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
}
