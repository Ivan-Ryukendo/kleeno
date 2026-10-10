import { guarded } from "@/server/auth/guard";
import { CorrectionCommandSchema, type CorrectionCommand } from "@/core/workflow/corrections";
import { loadReviewCorrections, linkReviewCorrection } from "@/server/db/review-corrections";
import { uuid } from "@/server/schemas";

export const GET = guarded<undefined, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] }, async ({ actor, client, params, correlationId, request }) => Response.json(await loadReviewCorrections(client, { ...actor, correlationId }, uuid.parse(params.id), new URL(request.url).searchParams.get("replacement") ?? undefined), { headers: { "Cache-Control": "no-store" } }));
export const POST = guarded<CorrectionCommand, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: CorrectionCommandSchema }, async ({ actor, client, params, body, correlationId }) => linkReviewCorrection(client, { ...actor, correlationId }, uuid.parse(params.id), body));
