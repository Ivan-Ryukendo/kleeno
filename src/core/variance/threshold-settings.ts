import { z } from "zod";
import type { HistoricalThresholds } from "./anomalies";
const integer = z.string().regex(/^\d{1,16}$/);
export const HistoricalThresholdRulesSchema = z.array(z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), component: z.string().min(1).max(160).nullable(),
  absolute: integer.nullable(), percent: z.object({ n: integer, d: integer.refine(v => BigInt(v) > 0n, "denominator must be positive") }).strict().nullable(),
}).strict().refine(v => v.absolute !== null || v.percent !== null, "a threshold is required")).max(20).refine(rules => new Set(rules.map(r => r.id)).size === rules.length, "duplicate threshold id");
export const HistoricalThresholdSettingsSchema = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), idempotencyKey: z.string().uuid(), rules: HistoricalThresholdRulesSchema }).strict();
export type HistoricalThresholdSettingsInput = z.infer<typeof HistoricalThresholdSettingsSchema>;
export interface HistoricalThresholdSettingsView {
  revision: number; version: string | null; configurationHash: string | null;
  rules: HistoricalThresholdSettingsInput["rules"]; canConfigure: boolean;
}
export function toHistoricalThresholds(version: string, input: HistoricalThresholdSettingsInput["rules"]): HistoricalThresholds {
  return { version, rules: HistoricalThresholdRulesSchema.parse(input).map(r => ({ id: r.id, component: r.component, ...(r.absolute !== null ? { absolute: BigInt(r.absolute) } : {}), ...(r.percent !== null ? { percent: { n: BigInt(r.percent.n), d: BigInt(r.percent.d) } } : {}) })) };
}
