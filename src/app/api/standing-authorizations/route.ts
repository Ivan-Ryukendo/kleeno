import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { createStanding, listStanding, revokeStanding } from "@/server/db/standing";
import { usdc, uuid } from "@/server/schemas";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), maxBatchTotal: usdc, maxPerPayment: usdc, expiresAt: z.string().datetime({ offset: true }), password: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("revoke"), id: uuid }).strict(),
]);
export const GET = guarded({ roles: ["PAYMENT_APPROVER"] }, async ({ actor, correlationId }) => listStanding({ ...actor, correlationId }));
export const POST = guarded<z.infer<typeof Body>>({ roles: ["PAYMENT_APPROVER"], body: Body }, async ({ actor, body, correlationId }) => {
  const who = { ...actor, correlationId };
  if (body.action === "revoke") return revokeStanding(who, body.id);
  await requireReauth(actor, body.password, correlationId);
  return createStanding(who, body);
});
