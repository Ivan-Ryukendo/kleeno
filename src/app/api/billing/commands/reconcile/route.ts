import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { reconcileCollectionCommand } from "@/server/db/billing-collection";
const Body = z.object({ commandId: z.string().uuid(), objectId: z.string().max(255) }).strict();
export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, correlationId }) => reconcileCollectionCommand({ companyId: actor.companyId, userId: actor.userId, correlationId }, body.commandId, body.objectId));
