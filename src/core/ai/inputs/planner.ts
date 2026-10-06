import { z } from "zod";
import { makeInput } from ".";

const id = z.string().uuid();
const micro = z.string().regex(/^\d{1,16}$/);
export const PlannerInputSchema = z.object({
  obligations: z.array(z.object({ id, workerRef: z.string().regex(/^W\d{3,}$/), amount: micro }).strict()).min(1).max(500),
  signals: z.array(z.object({ id: z.string().regex(/^(AMOUNT_RATIO|RECIPIENT_CHANGED|FIRST_PAYMENT):[\da-f-]{36}$|^CONFIG_VERSION_CHANGED$/i), code: z.enum(["AMOUNT_RATIO","RECIPIENT_CHANGED","FIRST_PAYMENT","CONFIG_VERSION_CHANGED"]), obligationId: id.nullable() }).strict()).max(2001),
  treasuryBalance: micro,
  batchTotal: micro,
}).strict();
export const plannerInput = (value: unknown, ref: string) => makeInput("PAYMENT_PLAN",PlannerInputSchema,value,ref);
