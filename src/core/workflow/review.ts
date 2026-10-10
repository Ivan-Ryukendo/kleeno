import { createHash } from "node:crypto";
import { z } from "zod";
import { toCsv } from "../growth";
import { isPayrollRole, type Role } from "../tenancy";
import { WorkflowError } from ".";

export const ACK_STATUSES = ["MANUAL_ACCEPTED", "MANUAL_REJECTED", "UNKNOWN"] as const;
const commandFields = { idempotencyKey: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), calculationId: z.string().uuid(), calculationHash: z.string().regex(/^[a-f0-9]{64}$/) };
export const ReviewCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...commandFields, action: z.literal("signoff") }).strict(),
  z.object({ ...commandFields, action: z.literal("export") }).strict(),
  z.object({ ...commandFields, action: z.literal("acknowledge"), status: z.enum(ACK_STATUSES), reference: z.string().trim().min(1).max(500) }).strict(),
]);
export type ReviewCommand = z.infer<typeof ReviewCommandSchema>;
export type ReviewTotals = { gross: string; deductions: string; net: string };
export interface ReviewView {
  revision: number;
  calculationId: string | null;
  calculationHash: string | null;
  signoff: null | { id: string; actor: string; at: string };
  export: null | { id: string; formatVersion: number; byteHash: string; totals: ReviewTotals; at: string };
  acknowledgement: null | { status: typeof ACK_STATUSES[number]; reference: string; at: string };
}

/** Review records never move the payroll state machine or grant payment authority. */
export function assertReviewAction(view: ReviewView, command: Pick<ReviewCommand, "action" | "calculationId" | "calculationHash" | "expectedRevision">, roles: readonly Role[]) {
  if (!isPayrollRole(roles)) throw new WorkflowError("FORBIDDEN", "only HR or payroll reviewers may sign off and record handoffs");
  if (view.revision !== command.expectedRevision || view.calculationId !== command.calculationId || view.calculationHash !== command.calculationHash) throw new WorkflowError("CONFLICT", "review evidence changed; refresh before continuing");
  if (command.action === "signoff" && view.signoff) throw new WorkflowError("CONFLICT", "this calculation already has a review sign-off");
  if (command.action === "export" && (!view.signoff || view.export)) throw new WorkflowError("CONFLICT", "a signed review needs one versioned export; download an existing manifest again");
  if (command.action === "acknowledge" && !view.export) throw new WorkflowError("CONFLICT", "generate a signed review export before recording a manual acknowledgement");
}

/** Version 1 exports immutable, pseudonymous calculation lines only; micro-USDC is exact integer text. */
export function buildReviewExport(input: { calculationId: string; calculationHash: string; configVersion: number; periodStart: string; periodEnd: string; lines: readonly { workerId: string; gross: bigint; deductions: bigint; net: bigint }[] }) {
  const ids = new Set<string>();
  const totals = { gross: 0n, deductions: 0n, net: 0n };
  const lines = [...input.lines].sort((a, b) => a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0);
  for (const line of lines) {
    if (ids.has(line.workerId) || line.gross < 0n || line.deductions < 0n || line.net < 0n || line.net !== line.gross - line.deductions) throw new WorkflowError("CALCULATION_BLOCKED", "export calculation lines are inconsistent");
    ids.add(line.workerId);
    totals.gross += line.gross; totals.deductions += line.deductions; totals.net += line.net;
  }
  if (!lines.length) throw new WorkflowError("CALCULATION_BLOCKED", "there are no calculation lines to export");
  const csv = toCsv(["format_version", "calculation_id", "calculation_hash", "config_version", "period_start", "period_end", "worker_id", "gross_micro_usdc", "deductions_micro_usdc", "net_micro_usdc"], lines.map((line) => [1, input.calculationId, input.calculationHash, input.configVersion, input.periodStart, input.periodEnd, line.workerId, line.gross.toString(), line.deductions.toString(), line.net.toString()]));
  return { csv, byteHash: createHash("sha256").update(csv, "utf8").digest("hex"), formatVersion: 1, totals: { gross: totals.gross.toString(), deductions: totals.deductions.toString(), net: totals.net.toString() } };
}
