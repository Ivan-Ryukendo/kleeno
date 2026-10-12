import { guarded } from "@/server/auth/guard";
import { HistoricalThresholdSettingsSchema } from "@/core/variance/threshold-settings";
import { loadHistoricalThresholds, saveHistoricalThresholds } from "@/server/db/historical-thresholds";
export const GET = guarded<undefined, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] }, async ({ client, actor, params }) => loadHistoricalThresholds(client, actor, params.id));
export const POST = guarded({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: HistoricalThresholdSettingsSchema }, async ({ client, actor, params, body, correlationId }) => saveHistoricalThresholds(client, { ...actor, correlationId }, params.id, body));
