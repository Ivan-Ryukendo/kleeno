import type { z } from "zod";

// The only way data reaches a prompt (rule 5, S21): strict schemas of IDs, numbers and enums. The only free text
// is HR policy clauses. No names, wallet addresses, notes or CSV cell text exist in any input schema.
export type AiOperation = "POLICY_INTERPRET" | "MAPPING_SUGGEST" | "RECON_CLASSIFY" | "VIEW_PROPOSE" | "WORKER_PROPOSE" | "PAYMENT_PLAN";

declare const typed: unique symbol;
/** Created only by `makeInput`; the provider adapter accepts nothing else. */
export interface AiInput {
  readonly [typed]: true;
  readonly operation: AiOperation;
  readonly json: string;
  readonly ref: string; // entity ID or hash stored in the AIExecution; never the input itself
}

export function makeInput<T>(operation: AiOperation, schema: z.ZodType<T>, value: unknown, ref: string): AiInput {
  return { operation, json: JSON.stringify(schema.parse(value)), ref } as unknown as AiInput;
}
