import { z } from "zod";
import { TransitionError } from "@/core/domain/machines";
import { guarded } from "@/server/auth/guard";
import { LEFT_REASONS, archiveWorker } from "@/server/db/workers";
import { isoDate, uuid } from "@/server/schemas";

const Body = z.object({ leftOn: isoDate, reason: z.enum(LEFT_REASONS) }).strict();

// Someone leaves: archived, never deleted. Unpaid obligations stay payable; the reply says how many are open.
export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  const id = uuid.safeParse(params.id);
  const r = id.success ? await archiveWorker({ companyId: actor.companyId, userId: actor.userId, correlationId }, id.data, body) : null;
  if (!r) throw new TransitionError("NOT_FOUND", "worker not found");
  return r;
});
