import { guarded } from "@/server/auth/guard";
import { CalendarDateSchema } from "@/core/workers";
import { ScheduleCompensationSchema, type ScheduleCompensation } from "@/core/workers/effective-compensation";
import { loadEffectiveCompensation, scheduleCompensation } from "@/server/db/effective-compensation";
import { uuid } from "@/server/schemas";

export const GET = guarded<undefined, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] }, async ({ actor, client, params, correlationId, request }) => {
  const query = new URL(request.url).searchParams, effectiveFrom = query.get("effectiveFrom"), start = query.get("periodStart"), end = query.get("periodEnd");
  const period = start !== null || end !== null ? { start: CalendarDateSchema.parse(start), end: CalendarDateSchema.parse(end) } : undefined;
  return Response.json(await loadEffectiveCompensation(client, { ...actor, correlationId }, uuid.parse(params.id), { period, effectiveFrom: effectiveFrom === null ? undefined : CalendarDateSchema.parse(effectiveFrom) }), { headers: { "Cache-Control": "no-store" } });
});
export const POST = guarded<ScheduleCompensation, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER"], body: ScheduleCompensationSchema }, async ({ actor, client, params, body, correlationId }) => scheduleCompensation(client, { ...actor, correlationId }, uuid.parse(params.id), body));
