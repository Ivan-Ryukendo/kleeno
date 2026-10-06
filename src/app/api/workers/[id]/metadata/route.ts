import { z } from "zod";
import { WorkerMetadataSchema } from "@/core/workers";
import { guarded } from "@/server/auth/guard";
import { updateWorkerMetadata } from "@/server/db/workers";
import { uuid } from "@/server/schemas";
import { TransitionError } from "@/core/domain/machines";

const Body = z.object({ metadata: WorkerMetadataSchema }).strict();
export const POST = guarded({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  const found = await updateWorkerMetadata({ ...actor, correlationId }, uuid.parse(params.id), body.metadata);
  if (!found) throw new TransitionError("NOT_FOUND", "worker not found");
  return { ok: true };
});
