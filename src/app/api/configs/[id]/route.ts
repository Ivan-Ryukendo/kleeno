import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { configAction } from "@/server/db/configs";
import { uuid } from "@/server/schemas";

// APIs take action names, never target states (rule 13). Flagged values need confirmFlags (ARCHITECTURE 7).
const Body = z.object({ action: z.enum(["approve", "send_back", "activate", "archive"]), confirmFlags: z.boolean().optional(), confirmOverrides: z.array(z.string().max(300)).max(500).optional() }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  const status = await configAction({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body.action, { confirmFlags: body.confirmFlags, confirmOverrides: body.confirmOverrides });
  return { status };
});
