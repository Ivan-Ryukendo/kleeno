import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { proposeConfig } from "@/server/ai/policy";

// Policy text goes to the AI as clauses; the result is a config in HUMAN_REVIEW, never an approved one (rule 2).
const Body = z.object({ policyText: z.string().min(1).max(40_000) }).strict();

export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, correlationId }) =>
  proposeConfig({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body.policyText),
);
