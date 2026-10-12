import { z } from "zod";
import { BillingCollectionSchema } from "@/core/billing-collection";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { collectStripeTest } from "@/server/db/billing-collection";
import { env } from "@/server/env";
const Body = z.object({ command: BillingCollectionSchema, password: z.string().min(1).max(200) }).strict();
export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  return collectStripeTest({ companyId: actor.companyId, userId: actor.userId, correlationId }, body.command, new URL(env.SITE_URL).origin);
});
