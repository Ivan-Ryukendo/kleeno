import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFacts } from "@/core/reconciliation";
import { formatUsdc } from "@/core/money";
import { applyView, columnsFor, defaultView, totalsFor, validateView, ViewError, type Row, type TableId, type TableResult, type ViewDef } from "@/core/views";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { openField } from "@/server/crypto";
import { loadLines } from "./calculations";
import { must } from "./client";
import { flaggedRecords, listExceptions } from "./reconciliation";
import { listWorkers } from "./workers";
import { evaluateResource, type ResourceCell } from "@/core/views/resources";
import { latestResourceInputs, resourceColumnDef, resourceColumns } from "./resources";

const MAX_ROWS = 500;

/** Loads every row of a table for the caller's company (and run), through the user-scoped client so RLS is the second wall (S11, S59). */
export async function loadTableRows(client: SupabaseClient, companyId: string, table: TableId, runId: string | null, roles: readonly Role[] = []): Promise<Row[]> {
  const financial = isPayrollRole(roles) || isPaymentRole(roles);
  if (table === "runs") {
    const rows: Row[] = [];
    let before: { createdAt: string; id: string } | null = null;
    // ponytail: bounded keysets avoid offset shifts when a new/backdated period
    // is created between reads. View sorting is applied after the full load.
    for (;;) {
      let query = client.from("payroll_runs").select("id,period_start,period_end,mode,status,created_at").eq("company_id", companyId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MAX_ROWS);
      if (before) query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
      const page = must(await query, "run table");
      if (rows.length + page.length > 10000) throw new ViewError("run history exceeds this view's supported limit");
      rows.push(...page.map((r) => ({ __rowId: r.id, periodStart: r.period_start, periodEnd: r.period_end, mode: r.mode, status: r.status, created: r.created_at.slice(0,10) })));
      if (page.length < MAX_ROWS) break;
      const last = page[page.length - 1];
      before = { createdAt: last.created_at, id: last.id };
    }
    return rows;
  }
  if (table === "workers") {
    if (!financial) {
      const read = await client.from("worker_directory").select("id, pseudonym, pay_type, active, left_on", { count: "exact" }).eq("company_id", companyId).order("pseudonym").limit(10001);
      const workers = must(read, "worker table");
      if (workers.length > 10000 || read.count !== workers.length) throw new ViewError("worker table is incomplete or exceeds this view's supported limit");
      return workers.map((w) => ({ __rowId: w.id, code: w.pseudonym, payType: w.pay_type, status: w.active ? "ACTIVE" : "LEFT", leftOn: w.left_on }));
    }
    const workers = await listWorkers(client, companyId);
    return workers.map((w) => ({ __rowId: w.id, code: w.pseudonym, payType: w.payType, status: w.active ? "ACTIVE" : "LEFT", base: w.compensation ? formatUsdc(w.compensation.baseAmount) : "", hourly: w.compensation ? formatUsdc(w.compensation.hourlyRate) : "", leftOn: w.leftOn }));
  }
  if (!runId) throw new ViewError("choose a run");
  const runRead = await client.from("payroll_runs").select("id").eq("id", runId).eq("company_id", companyId).maybeSingle();
  if (runRead.error) throw new ViewError("run table read unavailable");
  const run = runRead.data;
  if (!run) throw new ViewError("run not found"); // S13: another company's run looks the same as a missing one
  const codes = new Map(must(await client.from(financial ? "workers" : "worker_directory").select("id, pseudonym").eq("company_id", companyId), "workers read").map((w) => [w.id, w.pseudonym as string]));

  if (table === "timesheets" || table === "leave") {
    const flagged = await flaggedRecords(client, companyId, runId);
    const match = (id: string) => flagged.get(id) ?? "AUTO_MATCHED";
    if (table === "timesheets") {
      return must(await client.from("timesheets").select("id, worker_id, work_date, hours, approved_extra_hours, source_line").eq("company_id", companyId).eq("run_id", runId), "timesheets read").map((r) => ({ __rowId: r.id, worker: codes.get(r.worker_id) ?? "?", date: r.work_date, hours: String(r.hours), approvedExtra: String(r.approved_extra_hours), line: r.source_line, match: match(r.id) }));
    }
    return must(await client.from("leave_records").select("id, worker_id, leave_date, leave_type, hours, source_line").eq("company_id", companyId).eq("run_id", runId), "leave read").map((r) => ({ __rowId: r.id, worker: codes.get(r.worker_id) ?? "?", date: r.leave_date, leaveType: r.leave_type, hours: String(r.hours), line: r.source_line, match: match(r.id) }));
  }

  if (table === "exceptions") {
    return (await listExceptions(client, companyId, runId)).map((e) => ({ __rowId: e.id, worker: e.worker, category: e.category, severity: e.severity, status: e.status, detail: describeFacts(e.category, e.facts), decision: e.decision ?? "", suggestion: e.suggestion?.action ?? "", raised: e.createdAt.slice(0, 10) }));
  }

  // lines: the engine's result beside what the business actually paid
  const calcRead = await client.from("calculations").select("id").eq("company_id", companyId).eq("run_id", runId).maybeSingle();
  if (calcRead.error) throw new ViewError("pay-line calculation read unavailable");
  const calc = calcRead.data;
  if (!calc) return [];
  if (!financial) {
    const read = await client.from("calculation_line_metadata").select("id, worker_id", { count: "exact" }).eq("company_id", companyId).eq("calculation_id", calc.id).limit(10001);
    const lines = must(read, "pay-line table");
    if (lines.length > 10000 || read.count !== lines.length) throw new ViewError("pay-line table is incomplete or exceeds this view's supported limit");
    return lines.map((l) => ({ __rowId: l.id, worker: codes.get(l.worker_id) ?? "?" }));
  }
  const paid = new Map<string, bigint>();
  for (const p of must(await client.from("actual_payments").select("id, worker_id, amount_enc").eq("company_id", companyId).eq("run_id", runId), "actual payments read"))
    paid.set(p.worker_id, (paid.get(p.worker_id) ?? 0n) + BigInt(await openField(companyId, "actual_payments", "amount_enc", p.id, p.amount_enc)));
  return (await loadLines(client, companyId, calc.id)).map((l) => ({ __rowId: l.id, worker: codes.get(l.workerId) ?? "?", gross: formatUsdc(l.gross), deductions: formatUsdc(l.deductions), net: formatUsdc(l.net), paid: paid.has(l.workerId) ? formatUsdc(paid.get(l.workerId)!) : "" }));
}

/** Validate the view against the allow-list, filter/sort on the server, total exactly, and return only the columns this role may see. */
export async function queryTable(client: SupabaseClient, companyId: string, roles: readonly Role[], def: ViewDef, runId: string | null, opts: { all?: boolean } = {}): Promise<TableResult> {
  const resources = def.table === "workers" ? await resourceColumns(client, companyId, roles) : [];
  const custom = resources.map(resourceColumnDef);
  validateView(def, roles, custom);
  const rows = await loadTableRows(client, companyId, def.table, runId, roles);
  const cells: Record<string, Record<string, ResourceCell>> = {};
  for (let offset = 0; offset < rows.length && resources.length; offset += MAX_ROWS) {
    const group = rows.slice(offset, offset + MAX_ROWS);
    const inputs = await latestResourceInputs(client, companyId, resources.map((r) => r.id), group.map((r) => String(r.__rowId)));
    for (const row of group) {
      const rowId = String(row.__rowId);
      cells[rowId] = {};
      for (const column of resources) {
        const evidence = inputs.get(`${column.id}:${rowId}`);
        const cell = evaluateResource(column.definition, evidence?.input);
        if (evidence) {
          cell.inputRevision = { id: evidence.id, version: evidence.version, createdAt: evidence.createdAt };
          cell.sources.push(`Reviewed input v${evidence.version} / ${evidence.id} / ${evidence.createdAt}`);
        }
        cells[rowId][column.columnKey] = cell;
        row[column.columnKey] = cell.value;
      }
    }
  }
  const matched = applyView(rows, def, custom);
  const visible = columnsFor(def.table, roles, custom);
  const columns = def.columns.map((id) => visible.find((c) => c.id === id)!);
  const project = (r: Row) => Object.fromEntries(columns.map((c) => [c.id, r[c.id] ?? null]));
  const shown = opts.all ? matched : matched.slice(0, MAX_ROWS);
  return { columns, availableColumns: visible, rows: shown.map(project), rowIds: shown.map((r) => String(r.__rowId)), cells: Object.fromEntries(shown.map((r) => [String(r.__rowId), cells[String(r.__rowId)] ?? {}])), total: matched.length, totals: totalsFor(matched, def), truncated: shown.length < matched.length };
}

/** Everything a page needs to render a TableView with its default view already loaded. */
export async function initialTable(client: SupabaseClient, companyId: string, roles: readonly Role[], table: TableId, runId: string | null) {
  const view = defaultView(table, roles);
  const initial = await queryTable(client, companyId, roles, view, runId);
  return { table, runId, contextKey: `${companyId}:${[...roles].sort().join(",")}`, columns: initial.availableColumns ?? columnsFor(table, roles), initialView: view, initial };
}

