import "server-only";
import { randomUUID } from "node:crypto";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { FIELDS, OBJECT_OF, validateRows, type ImportType, type Rejected, type RowItem } from "@/core/ingest/rows";
import { parseUsdc } from "@/core/money";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { fingerprint, sealField } from "@/server/crypto";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { runStore } from "./runs";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}

const TABLE = { TIMESHEETS: "timesheets", LEAVE: "leave_records", ACTUAL_PAID: "actual_payments" } as const;
const OPEN_FOR_IMPORT = ["DRAFT", "DATA_IMPORTED"]; // data can be added until reconciliation starts (ARCHITECTURE 11)

export interface ImportResult {
  batchId: string | null;
  alreadyImported: boolean; // the same data was imported into this run before: nothing changed
  rows: number;
  accepted: number;
  newRecords: number; // accepted rows that were not already stored
  rejected: Rejected[];
}

/**
 * Server half of the import (S25): the browser sent only mapped, typed fields with W-codes. Everything is validated again,
 * checked against the company's workers and the run's period, fingerprinted, and stored with provenance in one transaction.
 */
export async function importRows(who: Who, input: { runId: string; type: ImportType; mapping: Record<string, number>; items: RowItem[] }): Promise<ImportResult> {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side imports data");
  const known = new Set(FIELDS[input.type].map((f) => f.name));
  if (Object.keys(input.mapping).some((k) => !known.has(k))) throw new WorkflowError("FORBIDDEN", "unknown field in the column mapping");

  const run = (await db().from("payroll_runs").select("status, period_start, period_end").eq("id", input.runId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!run) throw new TransitionError("NOT_FOUND", "run not found");
  if (!OPEN_FOR_IMPORT.includes(run.status)) throw new WorkflowError("RUN_FROZEN", `data can no longer be added in ${run.status}; start a new run`);

  const { good, rejected } = validateRows(input.type, input.items);
  const workers = new Map(must(await db().from("workers").select("id, pseudonym").eq("company_id", who.companyId), "workers read").map((w) => [w.pseudonym, w.id]));
  const dated = input.type !== "ACTUAL_PAID";
  const accepted = good.filter(({ row, value }) => {
    const v = value as { workerRef: string; date?: string };
    if (!workers.has(v.workerRef)) return void rejected.push({ row, field: "workerRef", code: "UNKNOWN_WORKER" });
    if (dated && (v.date! < run.period_start || v.date! > run.period_end)) return void rejected.push({ row, field: "date", code: "OUT_OF_PERIOD" });
    return true;
  });
  rejected.sort((a, b) => a.row - b.row);

  const total = input.items.length;
  const base: ImportResult = { batchId: null, alreadyImported: false, rows: total, accepted: accepted.length, newRecords: 0, rejected };
  if (accepted.length === 0) return base;

  // Identical lines inside one file keep distinct `occurrence` numbers, so a duplicated line is visible to reconciliation.
  const seen = new Map<string, number>();
  const records = await Promise.all(
    accepted.map(async ({ row, value }) => {
      const hash = await fingerprint(who.companyId, { type: input.type, ...(value as object) });
      const occurrence = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, occurrence);
      return { value: value as Record<string, string>, hash, occurrence, row };
    }),
  );
  const contentHash = await fingerprint(who.companyId, { type: input.type, records: records.map((r) => [r.hash, r.occurrence]) });
  const existing = (await db().from("import_batches").select("id").eq("company_id", who.companyId).eq("run_id", input.runId).eq("import_type", input.type).eq("content_hash", contentHash).maybeSingle()).data;
  if (existing) return { ...base, batchId: existing.id, alreadyImported: true };

  const batchId = randomUUID();
  const common = { company_id: who.companyId, run_id: input.runId, import_batch_id: batchId, source_provider: "csv_upload", object_type: OBJECT_OF[input.type], fetched_at: new Date().toISOString() };
  const rows = await Promise.all(
    records.map(async ({ value: v, hash, occurrence, row }) => {
      const id = randomUUID();
      const prov = { ...common, id, worker_id: workers.get(v.workerRef), object_id: input.type === "ACTUAL_PAID" ? v.workerRef : `${v.workerRef}|${v.date}`, source_hash: hash, occurrence, source_line: row };
      if (input.type === "TIMESHEETS") return { ...prov, work_date: v.date, hours: v.hours, approved_extra_hours: v.approvedExtraHours };
      if (input.type === "LEAVE") return { ...prov, leave_date: v.date, leave_type: v.leaveType, hours: v.hours };
      return { ...prov, amount_enc: await sealField(who.companyId, "actual_payments", "amount_enc", id, parseUsdc(v.amount).toString()), currency: v.currency };
    }),
  );
  const batch = { id: batchId, company_id: who.companyId, run_id: input.runId, import_type: input.type, source_provider: "csv_upload", content_hash: contentHash, mapping: input.mapping, row_count: total, rejected_count: rejected.length, rejected, created_by: who.userId };
  const saved = await db().rpc("save_import", { p_batch: batch, p_table: TABLE[input.type], p_rows: rows });
  if (saved.error) throw new Error(`db import save failed (${saved.error.code})`); // 23505 -> 409 via the route guard
  const newRecords = Number(saved.data);

  const correlationId = who.correlationId ?? newCorrelationId();
  if (run.status === "DRAFT") {
    try {
      await applyTransition(runStore, runMachine, { id: input.runId, companyId: who.companyId, action: "import_data", actor: who.userId, actorType: "user", correlationId });
    } catch (e) {
      if (!(e instanceof TransitionError && e.code === "STALE_STATE")) throw e; // another import moved it first: fine
    }
  }
  await writeAudit(auditEvent({ companyId: who.companyId, event: "import.create", entityType: "import_batch", entityId: batchId, actor: who.userId, actorType: "user", correlationId, refs: { runId: input.runId, type: input.type, rows: total, accepted: accepted.length, newRecords, rejected: rejected.length } }));
  return { ...base, batchId, newRecords };
}
