import { z } from "zod";
import { PayAdjustmentsSchema } from "@/core/engine";
import { guarded } from "@/server/auth/guard";
import { setRunAdjustments } from "@/server/db/calculate";
import { uuid } from "@/server/schemas";

const Body = z.object({ workerId: uuid, adjustments: PayAdjustmentsSchema }).strict();
export const POST = guarded({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  await setRunAdjustments({ ...actor, correlationId }, uuid.parse(params.id), body.workerId, body.adjustments);
  return { ok: true };
});
