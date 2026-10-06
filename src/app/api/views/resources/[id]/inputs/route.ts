import { z } from "zod";
import { ResourceInputSchema } from "@/core/views/resources";
import { guarded } from "@/server/auth/guard";
import { resourceColumns, resourceInput, saveResourceInput } from "@/server/db/resources";
import { uuid } from "@/server/schemas";
import { ViewError } from "@/core/views";

const roles = ["HR_APPROVER", "PAYROLL_APPROVER"] as const;
export const GET = guarded({ roles }, async ({ actor, client, params, request }) => {
  const id = uuid.parse(params.id);
  const workerId = uuid.parse(new URL(request.url).searchParams.get("workerId"));
  if (!(await resourceColumns(client, actor.companyId, actor.roles)).some((c) => c.id === id)) throw new ViewError("resource column not found");
  return resourceInput(client, actor.companyId, id, workerId);
});
const Body = z.object({ workerId: uuid, input: ResourceInputSchema, expectedVersion: z.number().int().positive().nullable() }).strict();
export const POST = guarded({ roles, body: Body }, async ({ actor, body, params, correlationId }) => saveResourceInput({ ...actor, correlationId }, uuid.parse(params.id), body.workerId, body.input, body.expectedVersion));
