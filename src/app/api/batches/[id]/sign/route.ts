import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { signBatch } from "@/server/db/batches";
import { uuid } from "@/server/schemas";

// Signing authorizes payment and releases holds: password re-checked in this request (S16); four-eyes is enforced by the database too.
const Body = z.object({ password: z.string().min(1).max(200) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYMENT_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  return signBatch({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id));
});
