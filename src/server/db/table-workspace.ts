import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPayrollRole, isPaymentRole, type Role } from "@/core/tenancy";
import { columnsFor, TABLES, validateView, ViewError, ViewSchema, type TableId, type ViewDef } from "@/core/views";
import { TransitionError } from "@/core/domain/machines";
import { openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { resourceColumnDef, resourceColumns } from "./resources";

interface Who { companyId: string; userId: string; roles: readonly Role[]; correlationId: string }
export interface CellTarget { table: TableId; runId: string | null; rowId: string; columnId: string }

async function customColumns(reader: SupabaseClient, companyId: string, roles: readonly Role[], table: TableId) {
  return table === "workers" ? (await resourceColumns(reader, companyId, roles)).map(resourceColumnDef) : [];
}

/** Validate a stable cell against its real entity, run, company and allowed columns before opening a thread. */
export async function authorizeCell(reader: SupabaseClient, companyId: string, roles: readonly Role[], target: CellTarget) {
  const allowed = columnsFor(target.table, roles, await customColumns(reader, companyId, roles, target.table));
  if (!allowed.some((c) => c.id === target.columnId)) throw new ViewError("column unavailable");
  const scope = TABLES[target.table].scope;
  if ((scope === "company" && target.runId !== null) || (scope === "run" && !target.runId)) throw new ViewError("choose the correct table period");
  const financial = isPayrollRole(roles) || isPaymentRole(roles);
  const source = { workers: financial ? "workers" : "worker_directory", runs: "payroll_runs", timesheets: "timesheets", leave: "leave_records", exceptions: "exceptions", lines: financial ? "calculation_lines" : "calculation_line_metadata" }[target.table];
  let query = reader.from(source).select(target.table === "lines" ? "id,calculation_id" : "id").eq("company_id", companyId).eq("id", target.rowId);
  if (scope === "run" && target.table !== "lines") query = query.eq("run_id", target.runId);
  const record = await query.maybeSingle();
  if (record.error) throw new Error("db cell target failed");
  if (!record.data) throw new TransitionError("NOT_FOUND", "cell not found");
  if (target.table === "lines") {
    const calc = await reader.from("calculations").select("id").eq("company_id", companyId).eq("run_id", target.runId).eq("id", (record.data as unknown as { calculation_id: string }).calculation_id).maybeSingle();
    if (calc.error) throw new Error("db cell period failed");
    if (!calc.data) throw new TransitionError("NOT_FOUND", "cell not found");
  }
}

export async function loadLayout(reader: SupabaseClient, companyId: string, userId: string, roles: readonly Role[], table: TableId) {
  const row = await reader.from("table_layouts").select("id,view_enc,version").eq("company_id", companyId).eq("owner_id", userId).eq("table_id", table).maybeSingle();
  if (row.error) throw new Error("db layout read failed");
  if (!row.data) return { view: null, version: null };
  const view = ViewSchema.parse(await openJson(companyId, "table_layouts", "view_enc", row.data.id, row.data.view_enc));
  if (view.table !== table) throw new ViewError("layout table mismatch");
  validateView(view, roles, await customColumns(reader, companyId, roles, table));
  return { view, version: row.data.version as number };
}

export async function saveLayout(who: Who, raw: ViewDef, expectedVersion: number | null) {
  const view = ViewSchema.parse(raw);
  validateView(view, who.roles, await customColumns(db(), who.companyId, who.roles, view.table));
  const current = await db().from("table_layouts").select("id,version").eq("company_id", who.companyId).eq("owner_id", who.userId).eq("table_id", view.table).maybeSingle();
  if (current.error) throw new Error("db layout state failed");
  if ((current.data?.version ?? null) !== expectedVersion) throw new TransitionError("STALE_STATE", "the layout changed; reload before saving");
  const id = current.data?.id ?? randomUUID();
  const version = (current.data?.version ?? 0) + 1;
  const view_enc = await sealJson(who.companyId, "table_layouts", "view_enc", id, view);
  if (current.data) {
    const updated = must(await db().from("table_layouts").update({ view_enc, version, correlation_id: who.correlationId, updated_at: new Date().toISOString() }).eq("company_id", who.companyId).eq("owner_id", who.userId).eq("id", id).eq("version", expectedVersion).select("id"), "layout update");
    if (!updated.length) throw new TransitionError("STALE_STATE", "the layout changed; reload before saving");
  } else must(await db().from("table_layouts").insert({ id, company_id: who.companyId, owner_id: who.userId, table_id: view.table, view_enc, version, correlation_id: who.correlationId }).select("id"), "layout create");
  return { version };
}

export async function cellComments(reader: SupabaseClient, companyId: string, roles: readonly Role[], target: CellTarget) {
  await authorizeCell(reader, companyId, roles, target);
  let query = reader.from("cell_comments").select("id,text_enc,author_id,created_at").eq("company_id", companyId).eq("table_id", target.table).eq("row_id", target.rowId).eq("column_id", target.columnId);
  query = target.runId ? query.eq("run_id", target.runId) : query.is("run_id", null);
  const rows = must(await query.order("created_at", { ascending: false }).limit(100), "cell comments");
  return { comments: await Promise.all(rows.reverse().map(async (r) => ({ id: r.id, text: (await openJson<{ text: string }>(companyId, "cell_comments", "text_enc", r.id, r.text_enc)).text, authorId: r.author_id as string, createdAt: r.created_at as string }))), truncated: rows.length === 100 };
}

export async function addCellComment(who: Who, reader: SupabaseClient, target: CellTarget, text: string) {
  await authorizeCell(reader, who.companyId, who.roles, target);
  if (!text.trim() || text.length > 2000) throw new ViewError("comment must contain 1–2000 characters");
  const id = randomUUID();
  const text_enc = await sealJson(who.companyId, "cell_comments", "text_enc", id, { text: text.trim() });
  must(await db().from("cell_comments").insert({ id, company_id: who.companyId, table_id: target.table, row_id: target.rowId, run_id: target.runId, column_id: target.columnId, text_enc, author_id: who.userId, correlation_id: who.correlationId }).select("id"), "cell comment");
  return { id };
}
