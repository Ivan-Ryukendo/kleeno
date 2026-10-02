import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFacts } from "@/core/reconciliation";
import { formatUsdc } from "@/core/money";
import { applyView, columnsFor, defaultView, totalsFor, validateView, ViewError, TABLES, type Row, type TableId, type TableResult, type ViewDef } from "@/core/views";
import type { Role } from "@/core/workflow";
import { openField } from "@/server/crypto";
import { loadLines } from "./calculations";
import { must } from "./client";
import { flaggedRecords, listExceptions } from "./reconciliation";
import { listWorkers } from "./workers";

const MAX_ROWS = 500;

/** Loads every row of a table for the caller's company (and run), through the user-scoped client so RLS is the second wall (S11, S59). */
async function loadRows(client: SupabaseClient, companyId: string, table: TableId, runId: string | null): Promise<Row[]> {
  if (TABLES[table].scope === "company") {
    const workers = await listWorkers(client, companyId);
    return workers.map((w) => ({ code: w.pseudonym, payType: w.payType, status: w.active ? "ACTIVE" : "LEFT", base: w.compensation ? formatUsdc(w.compensation.baseAmount) : "", hourly: w.compensation ? formatUsdc(w.compensation.hourlyRate) : "", leftOn: w.leftOn }));
  }
  if (!runId) throw new ViewError("choose a run");
  const run = (await client.from("payroll_runs").select("id").eq("id", runId).eq("company_id", companyId).maybeSingle()).data;
  if (!run) throw new ViewError("run not found"); // S13: another company's run looks the same as a missing one
  const codes = new Map(must(await client.from("workers").select("id, pseudonym").eq("company_id", companyId), "workers read").map((w) => [w.id, w.pseudonym as string]));

  if (table === "timesheets" || table === "leave") {
    const flagged = await flaggedRecords(client, companyId, runId);
    const match = (id: string) => flagged.get(id) ?? "AUTO_MATCHED";
    if (table === "timesheets") {
      return must(await client.from("timesheets").select("id, worker_id, work_date, hours, approved_extra_hours, source_line").eq("company_id", companyId).eq("run_id", runId), "timesheets read").map((r) => ({ worker: codes.get(r.worker_id) ?? "?", date: r.work_date, hours: String(r.hours), approvedExtra: String(r.approved_extra_hours), line: r.source_line, match: match(r.id) }));
    }
    return must(await client.from("leave_records").select("id, worker_id, leave_date, leave_type, hours, source_line").eq("company_id", companyId).eq("run_id", runId), "leave read").map((r) => ({ worker: codes.get(r.worker_id) ?? "?", date: r.leave_date, leaveType: r.leave_type, hours: String(r.hours), line: r.source_line, match: match(r.id) }));
  }

  if (table === "exceptions") {
    return (await listExceptions(client, companyId, runId)).map((e) => ({ worker: e.worker, category: e.category, severity: e.severity, status: e.status, detail: describeFacts(e.category, e.facts), decision: e.decision ?? "", suggestion: e.suggestion?.action ?? "", raised: e.createdAt.slice(0, 10) }));
  }

  // lines: the engine's result beside what the business actually paid
  const calc = (await client.from("calculations").select("id").eq("company_id", companyId).eq("run_id", runId).maybeSingle()).data;
  if (!calc) return [];
  const paid = new Map<string, bigint>();
  for (const p of must(await client.from("actual_payments").select("id, worker_id, amount_enc").eq("company_id", companyId).eq("run_id", runId), "actual payments read"))
    paid.set(p.worker_id, (paid.get(p.worker_id) ?? 0n) + BigInt(await openField(companyId, "actual_payments", "amount_enc", p.id, p.amount_enc)));
  return (await loadLines(client, companyId, calc.id)).map((l) => ({ worker: codes.get(l.workerId) ?? "?", gross: formatUsdc(l.gross), deductions: formatUsdc(l.deductions), net: formatUsdc(l.net), paid: paid.has(l.workerId) ? formatUsdc(paid.get(l.workerId)!) : "" }));
}

/** Validate the view against the allow-list, filter/sort on the server, total exactly, and return only the columns this role may see. */
export async function queryTable(client: SupabaseClient, companyId: string, role: Role, def: ViewDef, runId: string | null, opts: { all?: boolean } = {}): Promise<TableResult> {
  validateView(def, role);
  const matched = applyView(await loadRows(client, companyId, def.table, runId), def);
  const visible = columnsFor(def.table, role);
  const columns = def.columns.map((id) => visible.find((c) => c.id === id)!);
  const project = (r: Row) => Object.fromEntries(columns.map((c) => [c.id, r[c.id] ?? null]));
  const shown = opts.all ? matched : matched.slice(0, MAX_ROWS);
  return { columns, rows: shown.map(project), total: matched.length, totals: totalsFor(matched, def), truncated: shown.length < matched.length };
}

/** Everything a page needs to render a TableView with its default view already loaded. */
export async function initialTable(client: SupabaseClient, companyId: string, role: Role, table: TableId, runId: string | null) {
  const view = defaultView(table, role);
  return { table, runId, columns: columnsFor(table, role), initialView: view, initial: await queryTable(client, companyId, role, view, runId) };
}

