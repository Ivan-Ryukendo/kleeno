"use client";

import { useEffect, useRef, useState } from "react";
import type { NamedViewDetail, NamedViewSummary } from "@/core/named-views";
import type { ColumnDef, TableId, ViewDef } from "@/core/views";
import { ViewSchema } from "@/core/views";
import { postJson, type ApiResult } from "@/lib/api";

type Inventory = { views: NamedViewSummary[]; hasMore: boolean; canCreateTeam: boolean };
const control = "w-full min-w-0 min-h-11 rounded-field border bg-background px-3 py-2 text-sm";
const button = "min-h-11 rounded-field border px-4 py-2 text-sm disabled:opacity-50";

export function NamedViewSelector({ table, currentView, columns, onApply, onDenied }: { table: TableId; currentView: ViewDef; columns: ColumnDef[]; onApply: (view: ViewDef) => Promise<ApiResult<unknown>>; onDenied: (message: string) => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null), [selected, setSelected] = useState(""), [detail, setDetail] = useState<NamedViewDetail | null>(null);
  const [name, setName] = useState(""), [scope, setScope] = useState("PERSONAL"), [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const alert = useRef<HTMLParagraphElement>(null), pending = useRef<{ signature: string; key: string } | null>(null), sequence = useRef(0);
  const endpoint = `/api/tables/${table}/named-views`;
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => () => { sequence.current++; }, []);
  function fail(message: string, status?: number) { if (status === 401 || status === 403) { sequence.current++; setInventory(null); setDetail(null); setName(""); onDenied(message); } setError(message); }
  async function loadList() {
    const request = ++sequence.current; setLoading(true); setError(""); setNotice("");
    try { const response = await fetch(endpoint, { cache: "no-store" }); const data = await response.json(); if (request !== sequence.current) return;
      if (!response.ok) { fail(data.error?.message ?? "Named views could not be loaded.", response.status); return; }
      setInventory(data); if (!data.canCreateTeam) setScope("PERSONAL");
    } catch { if (request === sequence.current) setError("Named views could not be loaded. Retry to check the latest versions."); }
    finally { if (request === sequence.current) setLoading(false); }
  }
  async function loadDetail(id: string, preserveDraft = true) {
    const request = ++sequence.current; setLoading(true); setError(""); setNotice("");
    try { const response = await fetch(`${endpoint}/${id}`, { cache: "no-store" }); const data = await response.json(); if (request !== sequence.current) return;
      if (!response.ok) { setDetail(null); fail(data.error?.message ?? "This named view could not be loaded.", response.status); return; }
      setDetail(data); if (!preserveDraft || !name) setName(data.name ?? "");
    } catch { if (request === sequence.current) { setDetail(null); setError("The selected view could not be loaded. Retry before applying or updating it."); } }
    finally { if (request === sequence.current) setLoading(false); }
  }
  function choose(id: string) {
    if (name && name !== detail?.name && !window.confirm("Discard the named-view name draft?")) return;
    setSelected(id); setDetail(null); setName(""); pending.current = null;
    if (id) void loadDetail(id, false); else { sequence.current++; setLoading(false); setError(""); }
  }
  async function apply() {
    if (!detail?.available || !detail.view || detail.archived || busy) return;
    const parsed = ViewSchema.safeParse(detail.view), allowed = new Set(columns.map(column => column.id));
    if (!parsed.success || detail.view.table !== table || [...detail.view.columns, ...detail.view.filters.map(filter => filter.column), ...(detail.view.sort ? [detail.view.sort.column] : [])].some(id => !allowed.has(id))) { setError("This view contains unknown or unavailable fields. Nothing was applied. Reload the saved view or use the current table."); return; }
    setBusy(true); setError(""); const response = await onApply(parsed.data); setBusy(false);
    if (!response.ok) fail(response.error ?? "The named view could not be applied.", response.status);
    else setNotice("Named view applied to this table. Your personal default layout was not changed.");
  }
  async function mutate(action: "create" | "update" | "archive") {
    if (busy || !inventory) return;
    if (action !== "create" && (!detail || !detail.canEdit || detail.archived)) return;
    if (action !== "archive" && (!name.trim() || name.trim().length > 80)) { setError("Enter a view name of 1 to 80 characters."); return; }
    const payload = action === "create" ? { action, scope, name: name.trim(), view: currentView } : action === "update" ? { action, expectedRevision: detail!.revision, name: name.trim(), view: currentView } : { action, expectedRevision: detail!.revision };
    const signature = JSON.stringify({ id: action === "create" ? null : selected, payload });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice(""); const response = await postJson(action === "create" ? endpoint : `${endpoint}/${selected}`, { ...payload, idempotencyKey: pending.current.key }); setBusy(false);
    if (!response.ok) { fail(response.error ?? "The named view was not saved. Reload its current version before changing a stale view.", response.status); return; }
    pending.current = null; setNotice(action === "archive" ? "Named view archived. The current table remains as it is." : "Named view saved. Apply it separately when you want to use it.");
    // Refresh versions while preserving the owner's name draft and the current table.
    const request = ++sequence.current; setLoading(true);
    try { const result = await fetch(endpoint, { cache: "no-store" }); const data = await result.json(); if (request !== sequence.current) return; if (!result.ok) { fail(data.error?.message ?? "Saved views could not be refreshed.", result.status); return; } setInventory(data); if (selected) await loadDetail(selected); }
    catch { setError("The action succeeded but the current versions could not be refreshed. Reload before another update."); }
    finally { setLoading(false); }
  }
  return <section className="mb-4 min-w-0 rounded-box border p-3 space-y-3" aria-labelledby={`named-views-${table}`}><h3 id={`named-views-${table}`} className="text-sm font-medium">Named views</h3><p className="text-xs text-muted-foreground">Save the current column order, search, filters and sort as a personal or team view. Selection does not apply it automatically.</p>
    <button type="button" className={button} disabled={busy || loading} onClick={() => void loadList()}>{inventory ? "Reload named views" : "Load named views"}</button>
    {loading && <p role="status" className="text-sm">Loading named views…</p>}{error && <p role="alert" tabIndex={-1} ref={alert} className="rounded-box border border-destructive p-3 text-sm break-words">{error}</p>}
    {inventory && <><label className="block text-sm">Saved view<select aria-label="Saved view" className={control} value={selected} disabled={busy || loading} onChange={e => choose(e.target.value)}><option value="">Save a new copy</option>{inventory.views.map(item => <option key={item.id} value={item.id}>{item.name ?? "Unavailable view"} · {item.scope === "PERSONAL" ? "Personal" : "Team"} · v{item.revision}{item.archived ? " · archived" : ""}</option>)}</select></label>{inventory.hasMore && <p className="text-xs text-muted-foreground">Showing the most recent 100 named views.</p>}{!inventory.views.length && <p className="text-sm text-muted-foreground">No named views saved.</p>}
      {detail && <div className="rounded-box border p-3 text-sm space-y-2"><p>{detail.scope === "PERSONAL" ? "Personal" : "Team"} · loaded version {detail.revision}{detail.archived ? " · archived" : ""}</p><p className="break-all">Owner account: {detail.ownerId}</p>{inventory.views.some(item => item.id === detail.id && item.revision > detail.revision) && <p className="text-signal">A newer version is listed. Reload the selected version before updating.</p>}{!detail.available && <p className="text-signal">{detail.unavailableReason ?? "This saved definition is unavailable for your current role."}</p>}{detail.available && detail.view && <><p className="break-words">Saved columns: {detail.view.columns.map(id => columns.find(column => column.id === id)?.label ?? "Unavailable field").join(", ")}</p><p className="break-words">Saved search: {detail.view.search || "None"} · {detail.view.filters.length} filters</p></>}<button type="button" className={button} disabled={busy || loading || !detail.available || !detail.view || detail.archived} onClick={() => void apply()}>Apply selected view</button><details><summary className="min-h-11 py-3 cursor-pointer">Named view history</summary>{detail.history.map(event => <p key={event.id} className="break-all py-2">Version {event.revision} · {event.action} · account {event.actorId} · {event.createdAt}</p>)}{detail.hasMoreHistory && <p className="text-xs text-muted-foreground">Showing the most recent 100 history records.</p>}</details></div>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void mutate("create"); }}><label className="block text-sm">Named view name<input aria-label="Named view name" required maxLength={80} className={control} value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-sm">Copy scope<select aria-label="Copy scope" className={control} value={scope} onChange={e => setScope(e.target.value)}><option value="PERSONAL">Personal — only your account</option>{inventory.canCreateTeam && <option value="TEAM">Team — authorized company members</option>}</select></label><p className="text-xs text-muted-foreground">Saving deliberately shares the entered name and the current table search and filter text within this scope.</p><div className="flex flex-wrap gap-3"><button className={button} disabled={busy || loading || !name.trim()}>Save current table as a copy</button>{detail?.canEdit && !detail.archived && <><button type="button" className={button} disabled={busy || loading || !name.trim()} onClick={() => void mutate("update")}>Update selected view from current table</button><button type="button" className={button} disabled={busy || loading} onClick={() => void mutate("archive")}>Archive selected view</button></>}</div></form>
      {selected && <button type="button" className={button} disabled={busy || loading} onClick={() => void loadDetail(selected)}>Reload selected version (keep draft)</button>}
    </>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
