"use client";

import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import Link from "next/link";
import { ArrowLeft, ArrowRight, GripVertical, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResourceInputForm, type ResourceColumn } from "@/components/resource-column-form";
import { OPS, type ColumnDef, type TableId, type TableResult, type ViewDef } from "@/core/views";
import { postJson } from "@/lib/api";

const field = "h-8 rounded-field border border-field-border bg-white px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";
const OP_LABEL: Record<string, string> = { contains: "contains", equals: "is", is: "is", isNot: "is not", eq: "=", gt: ">", gte: "≥", lt: "<", lte: "≤", on: "on", before: "before", after: "after" };
const human = (v: string) => v.replaceAll("_", " ").toLowerCase();

export function reorderColumns(columns: string[], source: string, target: string): string[] {
  const from = columns.indexOf(source), to = columns.indexOf(target);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = [...columns]; next.splice(from, 1); next.splice(to, 0, source); return next;
}

export interface TableViewProps {
  table: TableId;
  runId: string | null;
  columns: ColumnDef[]; // every column this role may use
  initialView: ViewDef;
  initial: TableResult;
  empty?: string;
  contextKey?: string;
}

/** A dynamic table (columns, search, filters, sort, totals, CSV). The server validates and runs every view; this only edits it (S59). All cells are plain text (rule 6). */
export function TableView(props: TableViewProps) {
  return <TableViewState key={`${props.contextKey ?? "session"}:${props.table}:${props.runId ?? "company"}`} {...props} />;
}

function TableViewState({ table, runId, columns, initialView, initial, empty = "Nothing to show." }: TableViewProps) {
  const [view, setView] = useState<ViewDef>(initialView);
  const [result, setResult] = useState<TableResult>(initial);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ column: columns[0]?.id ?? "", op: "", value: "" });
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [context, setContext] = useState<{ rowId: string; column: ColumnDef; label: string; meta?: { formula: string; sources: string[]; status: string; editable: boolean }; startAtComments?: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const dragColumn = useRef<string | null>(null);
  const requestId = useRef(0);
  const available = [...new Map([...columns, ...(result.availableColumns ?? [])].map((c) => [c.id, c])).values()];
  const byId = new Map(available.map((c) => [c.id, c]));

  async function loadLayout() {
    try {
      const response = await fetch(`/api/views/layout?table=${table}`);
      const saved = await response.json();
      if (!response.ok) throw new Error("Could not load your saved layout.");
      setLayoutVersion(saved.version);
      if (saved.view) setView(saved.view);
      setLayoutLoaded(true); setError(null);
    } catch { setError("Could not load your saved layout. You can retry or keep using the current view."); setLayoutLoaded(true); }
  }
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/views/layout?table=${table}`).then(async (response) => {
      const saved = await response.json();
      if (!response.ok) throw new Error("layout read failed");
      if (!cancelled) { setLayoutVersion(saved.version); if (saved.view) setView(saved.view); setLayoutLoaded(true); }
    }).catch(() => { if (!cancelled) { setError("Could not load your saved layout. Reload it before saving changes."); setLayoutLoaded(true); } });
    return () => { cancelled = true; };
  }, [table]);

  useEffect(() => {
    if (!layoutLoaded) return;
    const current = ++requestId.current;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await postJson<TableResult>("/api/views/query", { view, runId });
      if (cancelled || requestId.current !== current) return;
      setLoading(false);
      if (r.ok && r.data) {
        setResult(r.data);
        setError(null);
      } else setError(r.error ?? "Could not load the table");
    }, 250);
    return () => { clearTimeout(t); cancelled = true; };
  }, [view, runId, layoutLoaded, revision]);

  async function saveLayout() {
    setSaving(true);
    const response = await postJson<{ version: number }>("/api/views/layout", { view, expectedVersion: layoutVersion });
    setSaving(false);
    if (response.ok && response.data) { setLayoutVersion(response.data.version); setError(null); setAnnouncement("Your personal layout was saved."); }
    else setError(response.error ?? "Could not save your layout. Reload it if another tab changed it.");
  }
  function move(source: string, target: string) {
    const reordered = reorderColumns(view.columns, source, target);
    setView((v) => ({ ...v, columns: reordered }));
    setAnnouncement(`${byId.get(source)?.label ?? source} moved to position ${reordered.indexOf(source) + 1}.`);
  }
  function openCell(rowId: string, column: ColumnDef, row: Record<string, string | number | null>, startAtComments = false) {
    setContext({ rowId, column, label: String(row.worker ?? row.code ?? "Record"), meta: result.cells?.[rowId]?.[column.id], startAtComments });
  }

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
          <div className="absolute z-10 mt-2 max-h-96 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-box border bg-popover p-3 shadow-pop"><p className="mb-2 text-xs text-muted-foreground">Drag columns or use Move left / right. Save to keep this layout for your account.</p>
            {[...view.columns, ...available.map((c) => c.id).filter((id) => !view.columns.includes(id))].map((id) => { const c = byId.get(id); if (!c) return null; const index = view.columns.indexOf(id); return <div key={id} className="flex min-h-11 items-center gap-2 border-t py-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragColumn.current && index >= 0) move(dragColumn.current, id); dragColumn.current = null; }}>
              <button className="flex size-11 shrink-0 cursor-grab items-center justify-center disabled:opacity-30" type="button" draggable={index >= 0} disabled={index < 0} aria-label={`Drag ${c.label} to reorder`} onDragStart={(e) => { dragColumn.current = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => { dragColumn.current = null; }}><GripVertical size={16} aria-hidden /></button>
              <label className="flex min-h-11 flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={index >= 0} onChange={(e) => set({ columns: e.target.checked ? [...view.columns, id] : view.columns.filter((value) => value !== id) })} disabled={view.columns.length === 1 && index >= 0} />{c.label}</label>
              {index >= 0 && <><Button type="button" variant="ghost" className="size-11" disabled={index === 0} aria-label={`Move ${c.label} left`} onClick={() => move(id, view.columns[index - 1])}><ArrowLeft aria-hidden /></Button><Button type="button" variant="ghost" className="size-11" disabled={index === view.columns.length - 1} aria-label={`Move ${c.label} right`} onClick={() => move(id, view.columns[index + 1])}><ArrowRight aria-hidden /></Button></>}
            </div>; })}
          </div>
        </details>
        <Button type="button" variant="outline" className="h-8 rounded-field px-3 text-sm" onClick={exportCsv}>
          Export CSV
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={!layoutLoaded || saving} onClick={saveLayout}>{saving ? "Saving…" : "Save my layout"}</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={loadLayout}>Reload saved layout</Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {loading && <p role="status" className="mt-2 text-xs text-muted-foreground">Updating table…</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter column" className={field} value={draft.column} onChange={(e) => setDraft({ column: e.target.value, op: "", value: "" })}>
          {available.map((c) => (
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
        <Button type="button" variant="outline" className="h-8 rounded-field px-3 text-sm" disabled={!draft.value.trim() || view.filters.length >= 8} onClick={() => (set({ filters: [...view.filters, { column: draft.column, op: draft.op || ops[0], value: draft.value.trim() }] }), setDraft({ ...draft, value: "" }))}>
          Add filter
        </Button>
        {view.filters.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-2 rounded-chip border bg-secondary px-2 py-0.5 text-sm">
            {byId.get(f.column)?.label} {OP_LABEL[f.op]} {byId.get(f.column)?.type === "enum" ? human(f.value) : f.value}
            <button type="button" aria-label={`Remove ${byId.get(f.column)?.label ?? f.column} filter`} className="min-h-6 min-w-6 rounded-chip font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => set({ filters: view.filters.filter((_, j) => j !== i) })}>
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
          <table aria-busy={loading} className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                {result.columns.map((c) => (
                  <th key={c.id} scope="col" draggable aria-sort={view.sort?.column === c.id ? (view.sort.dir === "asc" ? "ascending" : "descending") : "none"} onDragStart={(e) => { dragColumn.current = c.id; e.dataTransfer.setData("text/plain", c.id); }} onDragEnd={() => { dragColumn.current = null; }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragColumn.current) move(dragColumn.current, c.id); dragColumn.current = null; }} className={`py-2 pr-4 font-medium ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                    <button type="button" onClick={() => sortBy(c.id)} className="min-h-8 rounded-field font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {c.label}
                      {view.sort?.column === c.id ? (view.sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => { const rowId = result.rowIds?.[i]; return (
                <tr key={rowId ?? i} className="border-t border-border hover:bg-muted/40">
                  {result.columns.map((c) => (
                    <td key={c.id} className={`py-2 pr-4 ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                      {rowId ? (() => {
                        const meta = result.cells?.[rowId]?.[c.id];
                        const disclosureId = `cell-source-${rowId}-${c.id}`;
                        return <div className="group/cell relative flex min-h-11 items-center gap-1">
                          <ContextMenu.Root>
                            <ContextMenu.Trigger>
                              <button type="button" className={`min-h-11 min-w-0 flex-1 rounded-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${c.type === "money" || c.type === "number" ? "text-right" : "text-left"}`} aria-label={`View ${c.label} details for ${r.worker ?? r.code ?? "record"}`} aria-describedby={disclosureId} onClick={() => openCell(rowId, c, r)}>{cell(c, r[c.id])}</button>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                              <ContextMenu.Positioner className="z-50">
                                <ContextMenu.Popup className="min-w-48 rounded-field border border-border bg-popover p-1 text-popover-foreground shadow-pop">
                                  <ContextMenu.Item className="cursor-pointer rounded-chip px-3 py-3 text-sm outline-none focus:bg-muted data-highlighted:bg-muted" onClick={() => openCell(rowId, c, r)}>Formula and source details</ContextMenu.Item>
                                  <ContextMenu.Item className="cursor-pointer rounded-chip px-3 py-3 text-sm outline-none focus:bg-muted data-highlighted:bg-muted" onClick={() => openCell(rowId, c, r, true)}>Comments</ContextMenu.Item>
                                </ContextMenu.Popup>
                              </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                          </ContextMenu.Root>
                          <div id={disclosureId} className="pointer-events-none absolute bottom-full left-0 z-20 max-w-72 rounded-field border border-border bg-popover p-3 text-left text-xs font-normal text-popover-foreground opacity-0 shadow-pop transition-opacity duration-150 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 motion-reduce:transition-none">
                            <p className="font-medium">How this cell is produced</p>
                            <p className="mt-1">{meta?.formula ?? c.formula ?? "Recorded source value."}</p>
                            {meta?.status && <p className={`mt-1 ${meta.status === "DATA_REQUIRED" ? "text-signal" : "text-muted-foreground"}`}>{meta.status === "DATA_REQUIRED" ? "Approved source inputs required" : "Verified source inputs"}</p>}
                            {meta?.sources.map((source) => <p key={source} className="mt-1 break-words text-muted-foreground">{source}</p>)}
                          </div>
                          <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-field text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none" aria-label={`Comments for ${c.label}, ${r.worker ?? r.code ?? "record"}`} title="Comments" onClick={() => openCell(rowId, c, r, true)}><MessageSquareText size={16} aria-hidden="true" /></button>
                        </div>;
                      })() : cell(c, r[c.id])}
                    </td>
                  ))}
                </tr>
              ); })}
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
      {context && <CellContext key={`${context.rowId}:${context.column.id}`} table={table} runId={runId} context={context} onClose={() => setContext(null)} onSaved={() => { setContext(null); setRevision((v) => v + 1); }} />}
    </div>
  );
}

function CellContext({ table, runId, context, onClose, onSaved }: { table: TableId; runId: string | null; context: { rowId: string; column: ColumnDef; label: string; meta?: { formula: string; sources: string[]; status: string; editable: boolean }; startAtComments?: boolean }; onClose: () => void; onSaved: () => void }) {
  const [comments, setComments] = useState<{ id: string; text: string; authorId: string; createdAt: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [resource, setResource] = useState<ResourceColumn | null>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const target = { table, runId, rowId: context.rowId, columnId: context.column.id };
  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ table, runId: runId ?? "", rowId: context.rowId, columnId: context.column.id });
    fetch(`/api/views/comments?${query}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error("comments read failed"); if (!cancelled) { setComments(data.comments); setLoaded(true); } }).catch(() => { if (!cancelled) setError("Could not load shared comments. Close and reopen this cell to retry."); });
    if (context.column.resource) fetch("/api/views/resources").then(async (response) => { if (!response.ok) throw new Error("resource read failed"); const data = await response.json(); if (!cancelled) setResource(data.columns.find((c: ResourceColumn) => c.columnKey === context.column.id) ?? null); }).catch(() => { if (!cancelled) setError("Could not load the resource definition."); });
    return () => { cancelled = true; };
  }, [table, runId, context.rowId, context.column.id, context.column.resource]);

  async function comment() {
    setBusy(true);
    const response = await postJson<{ comment: { id: string; text: string; authorId: string; createdAt: string } }>("/api/views/comments", { ...target, text });
    setBusy(false);
    if (!response.ok) { setError(response.error ?? "Could not add your comment."); return; }
    // Re-read to keep the same server projection and include comments posted concurrently by teammates.
    try { const query = new URLSearchParams({ table, runId: runId ?? "", rowId: context.rowId, columnId: context.column.id }); const read = await fetch(`/api/views/comments?${query}`); if (!read.ok) throw new Error("comments read failed"); const data = await read.json(); setComments(data.comments); setText(""); setError(null); } catch { setError("Comment saved, but the discussion could not reload. Reopen this cell to see it."); setText(""); }
  }
  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent initialFocus={context.startAtComments ? commentInput : undefined} className="w-full max-w-full overflow-y-auto motion-reduce:transition-none sm:w-[30rem] sm:max-w-[30rem]"><SheetHeader><SheetTitle>{context.label} · {context.column.label}</SheetTitle><SheetDescription>Source context and shared discussion. Comments do not approve payroll or become policy evidence.</SheetDescription></SheetHeader><div className="px-4 pb-6">
    {table === "runs" && <Link href={`/runs/${context.rowId}`} className="mb-4 inline-block underline underline-offset-4">Open payroll run</Link>}{table === "workers" && <Link href={`/workers?worker=${context.rowId}`} className="mb-4 inline-block underline underline-offset-4">Open worker history</Link>}
    {table === "lines" && runId && <Link href={`/runs/${runId}#trace-${context.rowId}`} onClick={onClose} className="mb-4 inline-flex min-h-11 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open calculation trace for {context.label}</Link>}
    {(table === "timesheets" || table === "leave" || table === "exceptions") && runId && <Link href={`/exceptions?run=${runId}`} className="mb-4 inline-flex min-h-11 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open reconciliation evidence</Link>}
    <section><h3 className="font-medium">How this cell is produced</h3><p className="mt-2 text-sm">{context.meta?.formula ?? context.column.formula ?? "Recorded source value. Use the existing review workflow to change payroll records."}</p>{context.meta && <p className={`mt-2 text-xs ${context.meta.status === "DATA_REQUIRED" ? "text-signal" : "text-muted-foreground"}`}>{context.meta.status === "DATA_REQUIRED" ? "Approved source inputs required" : "Verified source inputs"}</p>}<ul className="mt-2 space-y-1 text-xs text-muted-foreground">{context.meta?.sources.map((source) => <li key={source} className="break-words">{source}</li>)}</ul>{context.meta && !context.meta.sources.length && <p className="mt-2 text-xs text-muted-foreground">No approved input source recorded for this resource yet.</p>}</section>
    {resource && context.meta?.editable && table === "workers" && <ResourceInputForm resource={resource} workerId={context.rowId} onSaved={onSaved} />}
    <section className="mt-5 border-t pt-4"><h3 className="font-medium">Shared cell comments</h3>{!loaded && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading discussion…</p>}{loaded && !comments.length && <p className="mt-3 text-sm text-muted-foreground">No comments yet.</p>}<ol className="mt-3 space-y-3">{comments.map((entry) => <li key={entry.id} className="rounded-field border p-3"><p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p><p className="mt-2 break-all text-xs text-muted-foreground">Member {entry.authorId}</p><time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("en", { timeZone: "UTC" })} UTC</time></li>)}</ol><label className="mt-4 block text-sm">Add a comment<Textarea ref={commentInput} maxLength={2000} className="mt-1" value={text} onChange={(e) => setText(e.target.value)} /></label><p className="mt-1 text-xs text-muted-foreground">Keep names, payout addresses and confidential pay details out of comments.</p><Button className="mt-3 min-h-11" disabled={busy || !loaded || !text.trim()} onClick={comment}>{busy ? "Adding…" : "Add shared comment"}</Button></section>
    {error && <p role="alert" className="mt-3 text-sm text-signal">{error}</p>}
  </div></SheetContent></Sheet>;
}
