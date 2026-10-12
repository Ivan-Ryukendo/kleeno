import { z } from "zod";
import { WorkflowError } from ".";
import { buildReviewExport } from "./review";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CorrectionCommandSchema = z.object({ replacementRunId: z.string().uuid(), originalCalculationId: z.string().uuid(), originalCalculationHash: hash, replacementCalculationId: z.string().uuid(), replacementCalculationHash: hash, originalReviewRevision: z.number().int().nonnegative(), replacementReviewRevision: z.literal(0), idempotencyKey: z.string().uuid(), reason: z.string().trim().min(1).max(2000), source: z.string().trim().min(1).max(500) }).strict();
export type CorrectionCommand = z.infer<typeof CorrectionCommandSchema>;
export interface CorrectionRun { id: string; companyId: string; mode: string; status: string; periodStart: string; periodEnd: string; calculationId: string; calculationHash: string; configVersion: number; reviewRevision: number; signoffId: string | null }
const validated = new Set(["CALCULATION_VALIDATED", "PENDING_APPROVAL", "APPROVED", "OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"]);
export function assertCorrectionPair(original: CorrectionRun, replacement: CorrectionRun, command: Omit<CorrectionCommand, "idempotencyKey" | "reason" | "source">) {
  if (!validated.has(original.status) || !original.signoffId || original.id === replacement.id || original.companyId !== replacement.companyId || original.periodStart !== replacement.periodStart || original.periodEnd !== replacement.periodEnd || replacement.mode !== "SIMULATION" || replacement.status !== "CALCULATION_VALIDATED" || replacement.signoffId || replacement.reviewRevision !== 0
    || original.calculationHash === replacement.calculationHash || original.calculationId !== command.originalCalculationId || original.calculationHash !== command.originalCalculationHash || original.reviewRevision !== command.originalReviewRevision || replacement.id !== command.replacementRunId || replacement.calculationId !== command.replacementCalculationId || replacement.calculationHash !== command.replacementCalculationHash || replacement.reviewRevision !== command.replacementReviewRevision) throw new WorkflowError("CONFLICT", "Choose a different, unsigned validated simulation of the exact signed period; refresh changed evidence");
}
type Line = { workerId: string; gross: bigint; deductions: bigint; net: bigint };
export function correctionDelta(original: readonly Line[], replacement: readonly Line[]) {
  // Reuse the exact immutable-line consistency checks; no current compensation or profile is consulted.
  for (const lines of [original, replacement]) buildReviewExport({ calculationId: "", calculationHash: "", configVersion: 1, periodStart: "", periodEnd: "", lines });
  const before = new Map(original.map(line => [line.workerId, line])), after = new Map(replacement.map(line => [line.workerId, line]));
  const totals = { gross: 0n, deductions: 0n, net: 0n };
  const workers = [...new Set([...before.keys(), ...after.keys()])].sort().map(workerId => {
    const previous = before.get(workerId), current = after.get(workerId);
    const delta = { gross: (current?.gross ?? 0n) - (previous?.gross ?? 0n), deductions: (current?.deductions ?? 0n) - (previous?.deductions ?? 0n), net: (current?.net ?? 0n) - (previous?.net ?? 0n) };
    totals.gross += delta.gross; totals.deductions += delta.deductions; totals.net += delta.net;
    return { workerId, change: !previous ? "ADDED" as const : !current ? "REMOVED" as const : Object.values(delta).every(value => value === 0n) ? "UNCHANGED" as const : "CHANGED" as const, delta: { gross: delta.gross.toString(), deductions: delta.deductions.toString(), net: delta.net.toString() } };
  });
  return { totals: { gross: totals.gross.toString(), deductions: totals.deductions.toString(), net: totals.net.toString() }, workers };
}
