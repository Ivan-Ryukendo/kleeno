import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { resolveException } from "@/server/db/reconciliation";
import { resolutionAction, uuid } from "@/server/schemas";

const Body = z.object({ action: resolutionAction, note: z.string().trim().min(3).max(500) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) =>
  resolveException({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body),
);
