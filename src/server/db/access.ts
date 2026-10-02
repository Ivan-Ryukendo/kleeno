import "server-only";
import { WorkflowError } from "@/core/workflow";
import { sendInviteEmail } from "@/server/email";
import { env } from "@/server/env";
import { db } from "./client";
import { createCompany } from "./company";
import { getContact } from "./growth";
import { issueInvite, leadInvites } from "./invites";

/**
 * Platform admin approves a waitlist entry (S64): a company is created for it and its owner gets a one-time invite.
 * Returns null when the contact does not exist. A second approval is refused while the first invite is pending or used;
 * after a revoke or expiry the empty company is reused instead of creating another.
 */
export async function approveAccess(contactId: string, adminId: string, sandbox: boolean, correlationId: string) {
  const contact = await getContact(contactId);
  if (!contact) return null;
  if (contact.status === "UNSUBSCRIBED" || contact.status === "CLOSED") throw new WorkflowError("CONFLICT", "this contact is closed or has unsubscribed");
  const prior = await leadInvites(contactId);
  if (prior.some((i) => i.status === "PENDING" || i.status === "USED")) throw new WorkflowError("CONFLICT", "access was already approved for this contact");

  let companyId: string | null = null;
  for (const i of prior) {
    const shell = (await db().from("companies").select("is_sandbox").eq("id", i.companyId).maybeSingle()).data;
    const members = (await db().from("memberships").select("user_id", { count: "exact", head: true }).eq("company_id", i.companyId)).count ?? 0;
    if (shell && shell.is_sandbox === sandbox && members === 0) {
      companyId = i.companyId;
      break;
    }
  }
  companyId ??= (await createCompany({ name: contact.company_name ?? "New company", isSandbox: sandbox, createdBy: adminId, correlationId, event: "company.approve" })).id;

  const invite = await issueInvite({ companyId, email: contact.email, roles: ["OWNER"], issuer: "PLATFORM", issuedBy: adminId, leadId: contactId, correlationId });
  const link = `${env.SITE_URL}/invite/${invite.token}`;
  const emailed = await sendInviteEmail(contact.email, link, contact.company_name ?? "your new company", "Kleeno");
  return { link, expiresAt: invite.expiresAt, emailed, companyId };
}
