import { z } from "zod";
import { TransitionError } from "@/core/domain/machines";
import { parseUsdc } from "@/core/money";
import { guarded } from "@/server/auth/guard";
import { COMP_REASONS, addCompensationVersion } from "@/server/db/workers";
import { usdc, uuid } from "@/server/schemas";

const Body = z.object({ payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]).optional(), baseAmount: usdc, hourlyRate: usdc.default("0"), reason: z.enum(COMP_REASONS) }).strict();

// A change is a new immutable compensation version, never an edit (S19, S20).
export const POST = guarded<z.infer<typeof Body>, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"], body: Body }, async ({ actor, body, params, correlationId }) => {
  const id = uuid.safeParse(params.id);
  const who = { companyId: actor.companyId, userId: actor.userId, correlationId };
  const ok = id.success && (await addCompensationVersion(who, id.data, { baseAmount: parseUsdc(body.baseAmount), hourlyRate: parseUsdc(body.hourlyRate) }, body.payType, body.reason));
  if (!ok) throw new TransitionError("NOT_FOUND", "worker not found");
  return { ok: true };
});
