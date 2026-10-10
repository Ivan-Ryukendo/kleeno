import { guarded } from "@/server/auth/guard";
import { ReviewTaskCommandSchema, type ReviewTaskCommand } from "@/core/workflow/review-tasks";
import { loadReviewTasks, reviewTaskAction } from "@/server/db/review-tasks";
import { uuid } from "@/server/schemas";

export const GET = guarded<undefined, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"] }, async ({ actor, client, params, correlationId }) =>
  loadReviewTasks(client, { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)));

export const POST = guarded<ReviewTaskCommand, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: ReviewTaskCommandSchema }, async ({ actor, client, params, body, correlationId }) =>
  reviewTaskAction(client, { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body));
