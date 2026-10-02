import { z } from "zod";
import { InviteRoles } from "@/core/invites";
import { isAuthorityRole } from "@/core/tenancy";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { changeRoles, listMembers, removeMember } from "@/server/db/team";

// Team management (S63): Owner only. Handing out payroll or payment authority needs the Owner's password again (rule 47).
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_roles"), roles: InviteRoles, password: z.string().max(200).optional() }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
]);

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["OWNER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  const target = z.uuid().parse(params.id);
  const who = { companyId: actor.companyId, userId: actor.userId, correlationId };
  if (body.action === "remove") {
    await removeMember(who, target);
    return { ok: true };
  }
  const held = (await listMembers(actor.companyId)).find((m) => m.userId === target)?.roles ?? [];
  if (body.roles.some((r) => isAuthorityRole(r) && !held.includes(r))) await requireReauth(actor, body.password, correlationId);
  return changeRoles(who, target, body.roles);
});
