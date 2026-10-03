import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { approveRun } from "@/server/db/approval";
import { uuid } from "@/server/schemas";

// Payroll approval grants authority, so the password is checked in this request (S16). It also creates the obligations.
const Body = z.object({ password: z.string().min(1).max(200) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  return approveRun({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id));
});
