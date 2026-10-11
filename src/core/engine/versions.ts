import { z } from "zod";

export const CalculationVersionsSchema = z.object({ engineVersion: z.literal(1), hashVersion: z.literal(1) }).strict();
export type CalculationVersions = z.infer<typeof CalculationVersionsSchema>;
// Legacy omission stays v1 even when a future release changes the current default.
export const LEGACY_CALCULATION_VERSIONS: Readonly<CalculationVersions> = Object.freeze({ engineVersion: 1, hashVersion: 1 });
export const CURRENT_CALCULATION_VERSIONS: Readonly<CalculationVersions> = Object.freeze({ engineVersion: 1, hashVersion: 1 });
export const capturedCalculationVersions = (value: unknown): CalculationVersions => value === undefined ? LEGACY_CALCULATION_VERSIONS : CalculationVersionsSchema.parse(value);
