import { z } from "zod";
import { ReviewSettingsSchema } from "@/core/workflow/review-settings";
import { guarded } from "@/server/auth/guard";
import { reviewReadiness, saveReviewSettings } from "@/server/db/review-readiness";

export const GET = guarded<undefined, { id: string }>({}, async ({ client, actor, params }) => reviewReadiness(client, actor.companyId, z.uuid().parse(params.id)));
export const POST = guarded({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: ReviewSettingsSchema }, async ({ actor, body, params, correlationId }) => saveReviewSettings({ ...actor, correlationId }, body, z.uuid().parse(params.id)));
