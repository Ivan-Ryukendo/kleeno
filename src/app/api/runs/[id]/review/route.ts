import { guarded } from "@/server/auth/guard";
import { ReviewCommandSchema, type ReviewCommand } from "@/core/workflow/review";
import { downloadReviewExport, loadPayrollReview, payrollReviewAction } from "@/server/db/payroll-review";
import { uuid } from "@/server/schemas";

export const GET = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER", "PAYMENT_APPROVER"] }, async ({ actor, client, params, request }) => {
  const runId = uuid.parse(params.id);
  if (new URL(request.url).searchParams.get("download") === "1") {
    const file = await downloadReviewExport(client, actor.companyId, runId);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return loadPayrollReview(client, actor.companyId, runId);
});

export const POST = guarded<ReviewCommand, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: ReviewCommandSchema }, async ({ actor, client, params, body, correlationId }) =>
  payrollReviewAction(client, { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id), body),
);
