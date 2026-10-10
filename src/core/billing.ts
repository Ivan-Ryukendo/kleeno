import { z } from "zod";
const cents = z.number().int().min(0).max(100_000_000);
export const PriceSchema = z.object({ name: z.string().trim().min(1).max(80), baseCents: cents, workerCents: cents }).strict();
const common = { id: z.string().uuid(), expectedRevision: z.number().int().min(0).max(2_147_483_646), idempotencyKey: z.string().uuid(), reason: z.string().trim().min(1).max(500) };
export const BillingCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), price: PriceSchema }).strict(),
  z.object({ ...common, action: z.literal("revise"), price: PriceSchema }).strict(),
  z.object({ ...common, action: z.literal("archive") }).strict(),
  z.object({ ...common, action: z.literal("assign"), companyId: z.string().uuid(), tierId: z.string().uuid().nullable(), tierRevision: z.number().int().positive().max(2_147_483_646).nullable(), price: PriceSchema, usageEnabled: z.boolean() }).strict(),
  z.object({ ...common, action: z.literal("activate_demo"), companyId: z.string().uuid() }).strict(),
]);
export type BillingCommand = z.infer<typeof BillingCommandSchema>;
export type Price = z.infer<typeof PriceSchema>;
export interface BillingTier extends Price { id: string; revision: number; archived: boolean }
export const BILLING_GATES = { provider: "UNCONFIGURED", collection: "UNAVAILABLE", mode: "TEST", retention: "UNCONFIGURED", support: "UNCONFIGURED", recovery: "UNCONFIGURED" } as const;
function timestamp(value: string) { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error("Invalid billing timestamp"); return result; }
export function usageMonth(value: string) { return new Date(timestamp(value)).toISOString().slice(0, 7) + "-01"; }
export function demoState(activatedAt: string | null, now: string): "NOT_ACTIVATED" | "ACTIVE" | "EXPIRED" {
  return activatedAt === null ? "NOT_ACTIVATED" : timestamp(now) < timestamp(activatedAt) + 48 * 60 * 60 * 1000 ? "ACTIVE" : "EXPIRED";
}
export function estimateCents(baseCents: number, workerCents: number, workers: number) {
  cents.parse(baseCents); cents.parse(workerCents); z.number().int().min(0).max(1_000_000).parse(workers);
  const total = baseCents + workerCents * workers; if (!Number.isSafeInteger(total)) throw new Error("Billing estimate exceeds safe cents"); return total;
}
