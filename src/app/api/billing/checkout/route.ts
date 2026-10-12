import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { collectStripeTest } from "@/server/db/billing-collection";
import { env } from "@/server/env";
const Body = z.object({ expectedBaseCents: z.number().int().min(0).max(100_000_000), idempotencyKey: z.string().uuid(), password: z.string().min(1).max(200) }).strict();
export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  return collectStripeTest({ companyId: actor.companyId, userId: actor.userId, correlationId }, { action: "checkout", expectedBaseCents: body.expectedBaseCents, idempotencyKey: body.idempotencyKey }, new URL(env.SITE_URL).origin);
});
