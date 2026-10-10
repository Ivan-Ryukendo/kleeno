import { createHash } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import { z } from "zod";
import { canonicalString } from "../canonical";
import { ConfigParamsSchema } from "../config";
import { calculatePayroll, PayAdjustmentsSchema, type EngineEntry, type PayrollLine } from "../engine";
import { CompensationSegmentsSchema, DatedHoursSchema } from "../engine/effective-compensation";
import { CalendarDateSchema, WorkerMetadataSchema } from "../workers";
import { WorkflowError } from ".";
import { buildReviewExport, type ReviewTotals } from "./review";

export const EVIDENCE_PACK_MAX_BYTES = 20 * 1024 * 1024;
const micro = z.union([z.bigint().nonnegative(), z.string().regex(/^\d{1,40}$/)]);
const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(80).optional();
const entry = z.object({
  compensationSegments: CompensationSegmentsSchema.optional(),
  worker: z.object({
    workerId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), pseudonym: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
    payType: z.enum(["SALARIED", "HOURLY", "RETAINER"]), baseAmount: micro, hourlyRate: micro,
    department: WorkerMetadataSchema.shape.department.optional(), jobTitle: WorkerMetadataSchema.shape.jobTitle.optional(),
    workerType: WorkerMetadataSchema.shape.workerType.optional(), tags: WorkerMetadataSchema.shape.tags.optional(),
    employmentStart: WorkerMetadataSchema.shape.employmentStart.optional(), employmentEnd: WorkerMetadataSchema.shape.employmentEnd.optional(),
  }).strict(),
  input: z.object({ datedHours: DatedHoursSchema.optional(), workedHours: decimal, approvedOvertimeHours: decimal, approvedAboveCapHours: decimal, approvedExtraHours: decimal, paidLeaveHours: decimal, unpaidLeaveHours: decimal, unexplainedHours: decimal,
    unpaidLeave: z.array(z.object({ date: CalendarDateSchema, hours: z.string().regex(/^\d+(\.\d+)?$/).max(80) }).strict()).max(10000).optional(), adjustments: PayAdjustmentsSchema.optional() }).strict(),
  period: z.object({ start: CalendarDateSchema, end: CalendarDateSchema }).strict().optional(),
}).strict();
const source = z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), source_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(10000);
const SnapshotSchema = z.object({
  config: ConfigParamsSchema.extend({ version: z.number().int().positive() }), entries: z.array(entry).min(1).max(10000),
  evidence: z.object({ timesheets: source, leave: source, actualPayments: source }).strict().optional(),
  decisions: z.record(z.string().min(1).max(200), z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).optional(),
  adjustmentRevision: z.number().int().nonnegative().optional(),
}).strict();
type Binding = { id: string; calculationId: string; calculationHash: string; at: string };
export interface EvidencePackInput {
  companyId: string; run: { id: string; periodStart: string; periodEnd: string };
  calculation: { id: string; calculationHash: string; configVersion: number }; snapshot: unknown; lines: readonly PayrollLine[];
  signoff: Binding & { actor: string };
  exported: Binding & { signoffId: string; formatVersion: number; byteHash: string; totals: ReviewTotals };
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const blocked = () => { throw new WorkflowError("CALCULATION_BLOCKED", "Signed calculation evidence is incomplete or does not reproduce its immutable hashes"); };
function jsonBytes(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalString(value));
  if (bytes.byteLength > EVIDENCE_PACK_MAX_BYTES) throw new WorkflowError("CALCULATION_BLOCKED", "Evidence pack size exceeds the supported 20MiB ceiling");
  return bytes;
}

/** Reproduce only strict captured inputs and complete immutable lines; shared by portable evidence and correction previews. */
export function verifyCapturedCalculation(input: Pick<EvidencePackInput, "snapshot" | "run" | "calculation" | "lines">) {
  const snapshotBytes = jsonBytes(input.snapshot);
  const parsed = SnapshotSchema.safeParse(input.snapshot);
  if (!parsed.success) return blocked();
  // Preserve the captured optional/default field presence: inserting defaults would change the engine hash.
  const snapshot = input.snapshot as z.infer<typeof SnapshotSchema>;
  const entries: EngineEntry[] = snapshot.entries.map(value => ({ ...value, worker: { ...value.worker, baseAmount: BigInt(value.worker.baseAmount), hourlyRate: BigInt(value.worker.hourlyRate) } }));
  const expected = new Set(entries.map(value => value.worker.workerId));
  const { run, calculation } = input;
  if (!z.string().uuid().safeParse(run.id).success || !CalendarDateSchema.safeParse(run.periodStart).success || !CalendarDateSchema.safeParse(run.periodEnd).success || run.periodEnd < run.periodStart
    || snapshot.config.version !== calculation.configVersion || expected.size !== entries.length || input.lines.length !== expected.size || new Set(input.lines.map(line => line.workerId)).size !== input.lines.length
    || input.lines.some(line => !expected.has(line.workerId)) || entries.some(value => value.period && (value.period.start !== run.periodStart || value.period.end !== run.periodEnd))) return blocked();
  const calculated = calculatePayroll(snapshot.config, entries);
  const lines = [...input.lines].sort((a, b) => a.workerId < b.workerId ? -1 : 1).map(line => ({ workerId: line.workerId, gross: line.gross, deductions: line.deductions, net: line.net, trace: line.trace }));
  if (calculated.calculationHash !== calculation.calculationHash || canonicalString(calculated.lines) !== canonicalString(lines)) return blocked();
  return { snapshotBytes, calculated, lines };
}

/** Fixed paths only. Recorded human sign-off is evidence, never a new approval/payment capability. */
export function buildEvidencePack(input: EvidencePackInput) {
  const { snapshotBytes, calculated, lines } = verifyCapturedCalculation(input);
  const { run, calculation, signoff, exported } = input;
  if ([signoff, exported].some(value => value.calculationId !== calculation.id || value.calculationHash !== calculation.calculationHash) || exported.signoffId !== signoff.id) return blocked();
  const csv = buildReviewExport({ calculationId: calculation.id, calculationHash: calculation.calculationHash, configVersion: calculation.configVersion, periodStart: run.periodStart, periodEnd: run.periodEnd, lines });
  if (csv.formatVersion !== exported.formatVersion || csv.byteHash !== exported.byteHash || canonicalString(csv.totals) !== canonicalString(exported.totals)) return blocked();
  const files = {
    "calculation.json": jsonBytes({ ...calculation, currency: "USDC", moneyUnit: "MICRO_USDC", lines, totals: calculated.totals }),
    "payroll.csv": new TextEncoder().encode(csv.csv),
    "review.json": jsonBytes({ signoff, export: exported, authority: "RECORDED_HUMAN_REVIEW_ONLY" }),
    "snapshot.json": snapshotBytes,
  };
  const manifest = { schemaVersion: 1, scope: "SIGNED_CALCULATION_EVIDENCE", companyId: input.companyId, run, calculationId: calculation.id, calculationHash: calculation.calculationHash,
    files: Object.entries(files).map(([path, bytes]) => ({ path, byteLength: bytes.byteLength, sha256: digest(bytes) })),
    limits: ["Comparison baseline was not captured by this sign-off", "Mutable readiness and task history are not signed evidence", "Human sign-off is not a public-key digital signature", "Export generation proves no delivery, provider acceptance or wage settlement", "No payroll or payment authority is granted"] };
  const all = { ...files, "manifest.json": jsonBytes(manifest) };
  if (Object.values(all).reduce((total, bytes) => total + bytes.byteLength, 0) > EVIDENCE_PACK_MAX_BYTES) throw new WorkflowError("CALCULATION_BLOCKED", "Evidence pack size exceeds the supported 20MiB ceiling");
  // Fixed local calendar fields produce identical ZIP timestamps across host timezones; UTC Date getters are not used by fflate.
  const zipped: Zippable = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a < b ? -1 : 1).map(([path, bytes]) => [path, [bytes, { level: 0, mtime: new Date(1980, 0, 1), os: 0, attrs: 0 }]]));
  const bytes = zipSync(zipped);
  if (bytes.byteLength > EVIDENCE_PACK_MAX_BYTES) throw new WorkflowError("CALCULATION_BLOCKED", "Evidence pack size exceeds the supported 20MiB ceiling");
  return { bytes, byteHash: digest(bytes), filename: `kleeno-signed-calculation-v1-${run.id}.zip` };
}
