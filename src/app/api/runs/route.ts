import { z } from "zod";
import { createRun } from "@/core/workflow";
import { guarded } from "@/server/auth/guard";
import { runDeps } from "@/server/db/runs";
import { isoDate } from "@/server/schemas";

// Mode is chosen once here and never changes (rule 17). SIMULATION is the default.
const Body = z.object({ mode: z.enum(["SIMULATION", "LIVE_TESTNET"]).default("SIMULATION"), periodStart: isoDate, periodEnd: isoDate }).strict();

export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, correlationId }) =>
  createRun(runDeps, { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body),
);
