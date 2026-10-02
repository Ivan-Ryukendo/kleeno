import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { bulkResolve } from "@/server/db/reconciliation";
import { reconCategory, resolutionAction, uuid } from "@/server/schemas";

// One category, one decision, one note, at most 200 exceptions of one run; all or nothing (S60). Approvals never go through here.
const Body = z.object({ runId: uuid, category: reconCategory, ids: z.array(uuid).min(1).max(200), action: resolutionAction, note: z.string().trim().min(3).max(500) }).strict();

export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, correlationId }) =>
  bulkResolve({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body),
);
