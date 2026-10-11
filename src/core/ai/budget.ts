import { z } from "zod";

export const AI_DAILY_TOKEN_LIMIT = 200_000;
export const AI_MAX_OUTPUT_TOKENS = 2_000;
export const AI_REQUEST_BYTE_LIMIT = 100_000;
export const AI_RESPONSE_BYTE_LIMIT = 64_000;
export class AiBudgetExhausted extends Error {
  constructor() { super("daily company AI budget exhausted; retry after the next UTC day"); }
}
export const aiTelemetrySchema = z.object({
  version: z.literal("ai-bound-v1"), attempts: z.number().int().nonnegative(),
  reservedTokens: z.number().int().nonnegative(), budgetEnforced: z.boolean(),
  maxOutputTokens: z.literal(AI_MAX_OUTPUT_TOKENS),
  pinnedModels: z.array(z.string().regex(/^[a-zA-Z0-9/_.:-]{1,200}$/)).min(1).max(2),
}).strict();
export type AiTelemetry = z.infer<typeof aiTelemetrySchema>;
