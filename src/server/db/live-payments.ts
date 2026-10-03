import "server-only";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { hasRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { provisionCompany, type ProvisionPort } from "@/server/circle/provisioning";
import { writeAudit } from "./audit";
import { db, must } from "./client";

// Live-payments activation (S66, rule 17): request -> platform approval -> provisioning -> the Owner switches ON. Demo and sandbox
// companies never get past NOT_REQUESTED (DB CHECK). Every step is a compare-and-set on `live_status`, so a repeat or a race is harmless.
type LiveStatus = "NOT_REQUESTED" | "REQUESTED" | "APPROVED" | "PROVISIONED" | "REJECTED";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}

const company = async (id: string) => must(await db().from("companies").select("id, is_demo, is_sandbox, live_status, live_payments_enabled").eq("id", id).single(), "company read");

/** Moves live_status from one of `from` to `to` in one statement. False when it was not in `from` (someone else moved it first). */
async function move(companyId: string, from: LiveStatus[], to: LiveStatus, extra: Record<string, unknown> = {}) {
  const rows = must(await db().from("companies").update({ live_status: to, ...extra }).eq("id", companyId).in("live_status", from).select("id"), "live status");
  return rows.length === 1;
}

const note = (companyId: string, event: string, actor: string, correlationId: string, refs: Record<string, string | number | boolean | null> = {}) =>
  writeAudit(auditEvent({ companyId, event, entityType: "company", entityId: companyId, actor, actorType: "user", correlationId, refs }));

/** The Owner asks for live payments. Needs no re-auth: it grants nothing until the platform admin approves. */
export async function requestLive(who: Who) {
  if (!hasRole(who.roles, "OWNER")) throw new WorkflowError("FORBIDDEN", "only the Owner can request live payments");
  const correlationId = who.correlationId ?? newCorrelationId();
  const co = await company(who.companyId);
  if (co.is_demo || co.is_sandbox) throw new WorkflowError("FORBIDDEN", "demo and sandbox companies cannot use live payments");
  if (!(await move(who.companyId, ["NOT_REQUESTED", "REJECTED"], "REQUESTED", { live_requested_by: who.userId, live_requested_at: new Date().toISOString() }))) {
    throw new TransitionError("INVALID_TRANSITION", `live payments are already ${co.live_status.toLowerCase().replace("_", " ")}`);
  }
  await note(who.companyId, "live.requested", who.userId, correlationId);
  return { status: "REQUESTED" as const };
}

/**
 * The platform admin's decision (the admin route has already required a platform admin with MFA). Approving provisions the wallets and
 * the guard straight away; if that fails the company stays APPROVED and approving again resumes it.
 */
export async function decideLive(admin: { userId: string }, companyId: string, decision: "approve" | "reject", correlationId: string = newCorrelationId(), port?: ProvisionPort) {
  const now = new Date().toISOString();
  if (decision === "reject") {
    if (!(await move(companyId, ["REQUESTED"], "REJECTED", { live_decided_by: admin.userId, live_decided_at: now }))) throw new TransitionError("INVALID_TRANSITION", "only a requested company can be rejected");
    await note(companyId, "live.rejected", admin.userId, correlationId);
    return { status: "REJECTED" as const };
  }
  if (await move(companyId, ["REQUESTED"], "APPROVED", { live_decided_by: admin.userId, live_decided_at: now })) await note(companyId, "live.approved", admin.userId, correlationId);
  else {
    const co = await company(companyId);
    if (co.live_status === "PROVISIONED") return { status: "PROVISIONED" as const };
    if (co.live_status !== "APPROVED") throw new TransitionError("INVALID_TRANSITION", `a ${co.live_status.toLowerCase().replace("_", " ")} company cannot be approved`);
  }
  await provisionCompany(companyId, port);
  await move(companyId, ["APPROVED"], "PROVISIONED"); // the trigger re-checks both wallets and the guard
  await note(companyId, "live.provisioned", admin.userId, correlationId);
  return { status: "PROVISIONED" as const };
}

/**
 * ON: the Owner only, for a provisioned company with a payroll approver and a different payment approver (the database checks this too).
 * The route has already re-checked the password and a fresh TOTP code. OFF: the Owner or a payment approver, nothing extra: it only reduces authority.
 */
export async function switchLive(who: Who, enabled: boolean) {
  const correlationId = who.correlationId ?? newCorrelationId();
  if (!enabled) {
    if (!hasRole(who.roles, "OWNER", "PAYMENT_APPROVER")) throw new WorkflowError("FORBIDDEN", "only the Owner or a payment approver can switch live payments off");
  } else {
    if (!hasRole(who.roles, "OWNER")) throw new WorkflowError("FORBIDDEN", "only the Owner can switch live payments on");
    const co = await company(who.companyId);
    if (co.is_demo || co.is_sandbox) throw new WorkflowError("FORBIDDEN", "demo and sandbox companies cannot use live payments");
    if (co.live_status !== "PROVISIONED") throw new WorkflowError("NOT_PROVISIONED", "live payments need platform approval and provisioning first");
    const members = must(await db().from("memberships").select("user_id, roles").eq("company_id", who.companyId).is("removed_at", null), "members read");
    const payroll = members.filter((m) => m.roles.includes("PAYROLL_APPROVER"));
    const payment = members.filter((m) => m.roles.includes("PAYMENT_APPROVER"));
    if (!payroll.some((a) => payment.some((b) => b.user_id !== a.user_id))) throw new WorkflowError("FORBIDDEN", "add a payroll approver and a different payment approver before switching live payments on");
  }
  must(await db().from("companies").update({ live_payments_enabled: enabled }).eq("id", who.companyId).select("id"), "live switch"); // the trigger is the backstop for ON
  await note(who.companyId, "LIVE_PAYMENTS_SWITCHED", who.userId, correlationId, { enabled });
  return { enabled };
}
