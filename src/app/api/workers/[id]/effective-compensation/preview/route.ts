import { guarded } from "@/server/auth/guard";
import { CompensationPreviewSchema, type CompensationPreview } from "@/core/workers/effective-compensation";
import { previewEffectiveCompensation } from "@/server/db/effective-compensation-preview";
import { uuid } from "@/server/schemas";

export const POST = guarded<CompensationPreview, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: CompensationPreviewSchema }, async ({ actor, client, params, body, correlationId }) => Response.json(await previewEffectiveCompensation(client, { ...actor, correlationId }, uuid.parse(params.id), body), { headers: { "Cache-Control": "no-store" } }));
