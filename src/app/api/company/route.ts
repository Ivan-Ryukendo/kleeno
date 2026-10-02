import { z } from "zod";
import { BasicsSchema, ScheduleSchema } from "@/core/company";
import { guarded } from "@/server/auth/guard";
import { updateProfile } from "@/server/db/company";

// Company details (Owner only): the wizard saves the basics, then the pay schedule; settings can save either again.
const Body = z.union([BasicsSchema, ScheduleSchema]);

export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, correlationId }) => {
  const after = await updateProfile({ companyId: actor.companyId, userId: actor.userId, correlationId }, body);
  return { onboarded: !!after.onboardedAt };
});
