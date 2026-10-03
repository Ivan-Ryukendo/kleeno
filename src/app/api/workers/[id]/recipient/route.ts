import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { changeRecipient } from "@/server/db/workers";
import { uuid } from "@/server/schemas";

// The HR side proposes an external address. It cannot be paid until a different payment approver confirms it.
const Body = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  await changeRecipient({ companyId: actor.companyId, userId: actor.userId, correlationId }, uuid.parse(params.id), body.address);
  return { ok: true };
});
