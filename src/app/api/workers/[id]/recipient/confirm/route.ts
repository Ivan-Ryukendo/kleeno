import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { confirmRecipient } from "@/server/db/workers";
import { uuid } from "@/server/schemas";

// Confirming a recipient widens payment authority: payment approver only, never the person who set it, password re-checked (S16).
const Body = z.object({ password: z.string().min(1).max(200) }).strict();

export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYMENT_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  await confirmRecipient({ companyId: actor.companyId, userId: actor.userId, correlationId }, uuid.parse(params.id));
  return { ok: true };
});
