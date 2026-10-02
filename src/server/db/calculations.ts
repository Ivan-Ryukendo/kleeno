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
export async function saveCalculation(companyId: string, runId: string, config: PayrollConfig, entries: EngineEntry[], calc: PayrollCalculation, extra: Record<string, unknown> = {}) {
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
  const saved = await db().rpc("save_calculation", { p_calc: { id: calcId, company_id: companyId, run_id: runId, config_version: config.version, calculation_hash: calc.calculationHash, snapshot_enc: snapshot }, p_lines: lines });
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
  const rows = must(await reader.from("calculation_lines").select("id, worker_id, net, gross_enc, deductions_enc, trace_enc").eq("company_id", companyId).eq("calculation_id", calculationId), "lines read");
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

