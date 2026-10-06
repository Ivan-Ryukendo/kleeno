import { z } from "zod";
import { ResourceDefinitionSchema } from "@/core/views/resources";
import { guarded } from "@/server/auth/guard";
import { createResourceColumn, resourceColumns } from "@/server/db/resources";

const roles = ["HR_APPROVER", "PAYROLL_APPROVER"] as const;
export const GET = guarded({ roles }, async ({ actor, client }) => ({ columns: await resourceColumns(client, actor.companyId, actor.roles) }));
const Body = z.object({ definition: ResourceDefinitionSchema, reason: z.string().trim().min(1).max(500) }).strict();
export const POST = guarded({ roles, body: Body }, async ({ actor, body, correlationId }) => createResourceColumn({ ...actor, correlationId }, body.definition, body.reason));
