import { guarded } from "@/server/auth/guard";
import { calculateRun } from "@/server/db/calculate";
import { uuid } from "@/server/schemas";

// No body: the action is the URL. The engine reads only reconciled data; a SIMULATION run ends at CALCULATION_VALIDATED (rule 17).
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) => {
  const r = await calculateRun({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id));
  return { calculationId: r.calculationId, calculationHash: r.calculationHash, status: r.status, workers: r.workers, variance: r.variance };
});
