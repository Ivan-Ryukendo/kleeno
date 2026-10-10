import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayrollConfig } from "@/core/config";
import type { EngineEntry, PayrollCalculation, TraceLine } from "@/core/engine";
import { openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";

/**
 * Stores one calculation: the snapshot (config + compensation + inputs), and per worker gross, deductions and trace,
 * all encrypted (S41). Only net stays plain (public on-chain). Rows are immutable once written (S19, S20).
 */
export async function saveCalculation(companyId: string, runId: string, config: PayrollConfig, entries: EngineEntry[], calc: PayrollCalculation, extra: Record<string, unknown> = {}, compensationRevisions?: Record<string, number>, actorId?: string) {
  const calcId = randomUUID();
  const snapshot = await sealJson(companyId, "calculations", "snapshot_enc", calcId, { config, entries, ...extra }); // extra: evidence references and decisions (S46, S48)
  const lineIds = new Map<string, string>();
  const lines = [];
  for (const l of calc.lines) {
    const id = randomUUID();
    lineIds.set(l.workerId, id);
    lines.push({
      id,
      company_id: companyId,
      calculation_id: calcId,
      worker_id: l.workerId,
      net: l.net.toString(), // text: no Number() precision loss
      gross_enc: await sealJson(companyId, "calculation_lines", "gross_enc", id, l.gross),
      deductions_enc: await sealJson(companyId, "calculation_lines", "deductions_enc", id, l.deductions),
      trace_enc: await sealJson(companyId, "calculation_lines", "trace_enc", id, l.trace),
    });
  }
  // One transaction: the calculation and every line, or nothing (both are immutable once written).
  const saved = await db().rpc("save_calculation", { p_calc: { id: calcId, company_id: companyId, run_id: runId, config_version: config.version, calculation_hash: calc.calculationHash, snapshot_enc: snapshot, adjustment_revision: extra.adjustmentRevision ?? 0, ...(compensationRevisions === undefined ? {} : { compensation_revisions: compensationRevisions }), ...(actorId === undefined ? {} : { actor_id: actorId }) }, p_lines: lines });
  if (saved.error) throw new Error(`db calculation save failed (${saved.error.code})`); // void result: must() would read null as failure
  return { calculationId: calcId, lineIds };
}

export interface LineView {
  id: string;
  workerId: string;
  gross: bigint;
  deductions: bigint;
  net: bigint;
  trace: TraceLine[];
}

/** Reads through the user-scoped client (RLS) and decrypts on the server. */
export async function loadLines(reader: SupabaseClient, companyId: string, calculationId: string): Promise<LineView[]> {
  const rows: { id: string; worker_id: string; net: string; gross_enc: string; deductions_enc: string; trace_enc: string }[] = [];
  const ids = new Set<string>(), workers = new Set<string>();
  let total: number | null = null;
  for (;;) {
    const result = await reader.from("calculation_lines").select("id, worker_id, net, gross_enc, deductions_enc, trace_enc", { count: "exact" }).eq("company_id", companyId).eq("calculation_id", calculationId).order("id").range(rows.length, rows.length + 499);
    const page = must(result, "lines read");
    // ponytail: bounded in-memory 10,000-worker read; use streamed calculation/export views beyond this supported ceiling.
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 10000 || total !== null && result.count !== total) throw new Error("calculation line count is incomplete or exceeds the supported view");
    total = result.count;
    for (const row of page) {
      if (ids.has(row.id) || workers.has(row.worker_id)) throw new Error("duplicate calculation line in paginated read");
      ids.add(row.id); workers.add(row.worker_id); rows.push(row);
    }
    if (rows.length === total) break;
    if (!page.length || rows.length > total) throw new Error("calculation line read is incomplete");
  }
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      workerId: r.worker_id,
      net: BigInt(r.net),
      gross: BigInt(await openJson<string>(companyId, "calculation_lines", "gross_enc", r.id, r.gross_enc)),
      deductions: BigInt(await openJson<string>(companyId, "calculation_lines", "deductions_enc", r.id, r.deductions_enc)),
      trace: (await openJson<(Omit<TraceLine, "amount"> & { amount: string })[]>(companyId, "calculation_lines", "trace_enc", r.id, r.trace_enc)).map((t) => ({ ...t, amount: BigInt(t.amount) })),
    })),
  );
}

