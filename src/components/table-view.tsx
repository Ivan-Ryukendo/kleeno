"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OPS, type ColumnDef, type TableId, type TableResult, type ViewDef } from "@/core/views";
import { postJson } from "@/lib/api";

const field = "h-9 rounded-full border border-primary/50 bg-white px-4 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";
const OP_LABEL: Record<string, string> = { contains: "contains", equals: "is", is: "is", isNot: "is not", eq: "=", gt: ">", gte: "≥", lt: "<", lte: "≤", on: "on", before: "before", after: "after" };
const human = (v: string) => v.replaceAll("_", " ").toLowerCase();

export interface TableViewProps {
  table: TableId;
  runId: string | null;
  columns: ColumnDef[]; // every column this role may use
  initialView: ViewDef;
  initial: TableResult;
  empty?: string;
}

/** A dynamic table (columns, search, filters, sort, totals, CSV). The server validates and runs every view; this only edits it (S59). All cells are plain text (rule 6). */
export function TableView({ table, runId, columns, initialView, initial, empty = "Nothing to show." }: TableViewProps) {
  const [view, setView] = useState<ViewDef>(initialView);
  const [result, setResult] = useState<TableResult>(initial);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ column: columns[0]?.id ?? "", op: "", value: "" });
  const first = useRef(true);
  const byId = new Map(columns.map((c) => [c.id, c]));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const r = await postJson<TableResult>("/api/views/query", { view, runId });
      if (r.ok && r.data) {
        setResult(r.data);
        setError(null);
      } else setError(r.error ?? "Could not load the table");
    }, 250);
    return () => clearTimeout(t);
  }, [view, runId]);

  const dc = byId.get(draft.column);
  const ops = dc ? OPS[dc.type] : [];
  const set = (patch: Partial<ViewDef>) => setView((v) => ({ ...v, ...patch }));
  const sortBy = (id: string) => set({ sort: view.sort?.column === id ? (view.sort.dir === "asc" ? { column: id, dir: "desc" } : null) : { column: id, dir: "asc" } });

  async function exportCsv() {
    const res = await fetch("/api/views/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ view, runId }) });
    if (!res.ok) return setError("Could not export");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `kleeno-${table}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cell = (c: ColumnDef, v: string | number | null) => {
    if (v === null || v === "") return <span className="text-muted-foreground">—</span>;
    const text = c.type === "enum" ? human(String(v)) : String(v);
    return <span className={c.id === "match" && v === "EXCEPTION" ? "font-medium text-signal" : ""}>{text}</span>;
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search" placeholder="Search" value={view.search} onChange={(e) => set({ search: e.target.value })} className="h-9 w-48" />
        <details className="relative">
          <summary className={`${field} flex cursor-pointer list-none items-center`}>Columns</summary>
          <div className="absolute z-10 mt-2 w-56 rounded-[1.25rem] border border-primary/50 bg-white p-4 shadow-card">
            {columns.map((c) => (
              <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={view.columns.includes(c.id)} onChange={(e) => set({ columns: e.target.checked ? columns.map((x) => x.id).filter((id) => id === c.id || view.columns.includes(id)) : view.columns.filter((id) => id !== c.id) })} disabled={view.columns.length === 1 && view.columns.includes(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
        </details>
        <Button type="button" variant="outline" className="h-9 rounded-full px-4 text-sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter column" className={field} value={draft.column} onChange={(e) => setDraft({ column: e.target.value, op: "", value: "" })}>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter operator" className={field} value={draft.op || ops[0]} onChange={(e) => setDraft({ ...draft, op: e.target.value })}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
        {dc?.type === "enum" && dc.values ? (
          <select aria-label="Filter value" className={field} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}>
            <option value="">Choose…</option>
            {dc.values.map((v) => (
              <option key={v} value={v}>
                {human(v)}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Filter value" className={field} value={draft.value} placeholder={dc?.type === "date" ? "YYYY-MM-DD" : "value"} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
        )}
        <Button type="button" variant="outline" className="h-9 rounded-full px-4 text-sm" disabled={!draft.value.trim() || view.filters.length >= 8} onClick={() => (set({ filters: [...view.filters, { column: draft.column, op: draft.op || ops[0], value: draft.value.trim() }] }), setDraft({ ...draft, value: "" }))}>
          Add filter
        </Button>
        {view.filters.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm">
            {byId.get(f.column)?.label} {OP_LABEL[f.op]} {byId.get(f.column)?.type === "enum" ? human(f.value) : f.value}
            <button type="button" aria-label="Remove filter" className="font-medium" onClick={() => set({ filters: view.filters.filter((_, j) => j !== i) })}>
              ×
            </button>
          </span>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-signal">
          {error}
        </p>
      )}

      {result.rows.length === 0 ? (
        <p className="mt-6 text-muted-foreground">{view.filters.length || view.search ? "No rows match this view." : empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                {result.columns.map((c) => (
                  <th key={c.id} aria-sort={view.sort?.column === c.id ? (view.sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 pr-4 font-medium ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                    <button type="button" onClick={() => sortBy(c.id)} className="font-medium">
                      {c.label}
                      {view.sort?.column === c.id ? (view.sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {result.columns.map((c) => (
                    <td key={c.id} className={`py-2 pr-4 ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                      {cell(c, r[c.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {Object.keys(result.totals).length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  {result.columns.map((c, i) => (
                    <td key={c.id} className={`py-2 pr-4 ${c.type === "money" ? "text-right" : ""}`}>
                      {result.totals[c.id] ?? (i === 0 ? "Total" : "")}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        {result.total} {result.total === 1 ? "row" : "rows"}
        {result.truncated ? `; showing the first ${result.rows.length}. Filter or export to see the rest.` : ""}
      </p>
    </div>
  );
}
