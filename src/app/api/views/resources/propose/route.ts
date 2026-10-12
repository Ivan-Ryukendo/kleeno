import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { proposeResourceColumns } from "@/server/ai/resources";
import { allow } from "@/server/db/growth";
import { canonicalHash } from "@/core/canonical";
import { AuthError } from "@/server/auth/session";

const Body = z.object({ configVersion: z.number().int().positive() }).strict();
export const POST = guarded({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: Body }, async ({ actor, body, correlationId }) => {
  if (!(await allow("resource-policy", canonicalHash({ companyId: actor.companyId, userId: actor.userId }), 3600, 20))) throw new AuthError(429, "THROTTLED", "too many requests; try again later");
  return proposeResourceColumns({ ...actor, correlationId }, body.configVersion);
});
