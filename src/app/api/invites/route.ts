import { z } from "zod";
import { InviteEmail, InviteRoles, needsReauth } from "@/core/invites";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { db } from "@/server/db/client";
import { issueInvite } from "@/server/db/invites";
import { sendInviteEmail } from "@/server/email";
import { env } from "@/server/env";

// An Owner invites a team member with roles. Granting payroll or payment authority needs the Owner's password (rule 47, S63).
const Body = z.object({ email: InviteEmail, roles: InviteRoles, password: z.string().max(200).optional() }).strict();

export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, correlationId }) => {
  if (needsReauth(body.roles)) await requireReauth(actor, body.password, correlationId);
  const invite = await issueInvite({ companyId: actor.companyId, email: body.email, roles: body.roles, issuer: "OWNER", issuedBy: actor.userId, correlationId });
  const link = `${env.SITE_URL}/invite/${invite.token}`;
  const company = (await db().from("companies").select("name").eq("id", actor.companyId).single()).data;
  const emailed = await sendInviteEmail(body.email, link, company?.name ?? "your company", "An Owner");
  return { id: invite.id, link, expiresAt: invite.expiresAt, emailed };
});
