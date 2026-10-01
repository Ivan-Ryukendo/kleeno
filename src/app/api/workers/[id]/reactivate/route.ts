import { TransitionError } from "@/core/domain/machines";
import { guarded } from "@/server/auth/guard";
import { reactivateWorker } from "@/server/db/workers";
import { uuid } from "@/server/schemas";

export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) => {
  const id = uuid.safeParse(params.id);
  if (!id.success || !(await reactivateWorker({ companyId: actor.companyId, userId: actor.userId, correlationId }, id.data))) throw new TransitionError("NOT_FOUND", "worker not found");
  return { ok: true };
});
