import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { proposeConfig } from "@/server/ai/policy";
import { PolicyDocumentsSchema } from "@/core/config";

// Policy text goes to the AI as clauses; the result is a config in HUMAN_REVIEW, never an approved one (rule 2).
const Body = z.object({ policyText: z.string().min(1).max(40_000), documents: PolicyDocumentsSchema.optional() }).strict();

// Text plus reviewed provenance is normalized JSON, bounded separately from originals that stay in the browser.
export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body, maxBodyBytes: 1024 * 1024 }, async ({ actor, body, correlationId }) =>
  proposeConfig({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body.policyText, undefined, body.documents),
);
