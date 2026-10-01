import { z } from "zod";
import { parseUsdc } from "@/core/money";
import { guarded } from "@/server/auth/guard";
import { createWorker } from "@/server/db/workers";
import { usdc } from "@/server/schemas";

// Worker refs are pseudonymous (W001...): real names never reach the server (rule 35, S25).
const Body = z
  .object({ pseudonym: z.string().regex(/^W\d{3,}$/), payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]), baseAmount: usdc, hourlyRate: usdc.default("0") })
  .strict();

export const POST = guarded({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, correlationId }) =>
  createWorker({ companyId: actor.companyId, userId: actor.userId, correlationId }, { pseudonym: body.pseudonym, payType: body.payType, compensation: { baseAmount: parseUsdc(body.baseAmount), hourlyRate: parseUsdc(body.hourlyRate) } }),
);
