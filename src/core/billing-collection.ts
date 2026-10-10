import { z } from "zod";
import { PriceSchema } from "./billing";
export const BillingCollectionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), expectedBaseCents: z.number().int().min(0).max(100_000_000), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("cancel"), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("usage"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/), expectedAmountCents: z.number().int().min(0).max(100_000_000), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: z.string().uuid() }).strict(),
]);
export type BillingCollection = z.infer<typeof BillingCollectionSchema>;
export function closedUsageMonth(month: string, now = new Date().toISOString()) {
  const parsed = BillingCollectionSchema.options[2].shape.month.parse(month);
  if (parsed >= new Date(now).toISOString().slice(0, 7) + "-01") throw new Error("Only a closed UTC month can be invoiced");
  return parsed;
}
export function usageCharge(rows: readonly { workerId: string; assignmentId: string }[], prices: ReadonlyMap<string, unknown>) {
  if (rows.length > 10000 || new Set(rows.map(row => row.workerId)).size !== rows.length) throw new Error("Incomplete or duplicate monthly usage");
  let amountCents = 0;
  for (const row of rows) {
    const price = PriceSchema.parse(prices.get(row.assignmentId)); amountCents += price.workerCents;
    if (!Number.isSafeInteger(amountCents) || amountCents > 100_000_000) throw new Error("Monthly invoice exceeds supported USD cents");
  }
  return { amountCents, uniqueWorkers: rows.length };
}
