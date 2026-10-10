"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api";
import type { SupportThread, SupportTicketMeta } from "@/core/support";

type Props = { mode: "requester" | "staff"; apiBase: string; initialTickets: SupportTicketMeta[]; initialHasMore?: boolean; initialTicketId?: string | null; initialError?: string | null; currentUserId: string };
const field = "w-full min-w-0 min-h-11 rounded-field border bg-background px-3 py-2 text-sm";
const button = "min-h-11 rounded-field border px-4 py-2 text-sm disabled:opacity-50";
const references = (value: string) => value.split("\n").map(s => s.trim()).filter(Boolean);

export function SupportPanel({ mode, apiBase, initialTickets, initialHasMore = false, initialTicketId, initialError, currentUserId }: Props) {
  const [tickets, setTickets] = useState(initialTickets), [hasMore, setHasMore] = useState(initialHasMore);
  const [selected, setSelected] = useState(initialTicketId ?? ""), [thread, setThread] = useState<SupportThread | null>(null);
  const [error, setError] = useState(initialError ?? ""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [denied, setDenied] = useState(false);
  const [refresh, setRefresh] = useState(0), [reply, setReply] = useState(""), [replyRefs, setReplyRefs] = useState(""), [shared, setShared] = useState(false);
  const [note, setNote] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState(""), [createRefs, setCreateRefs] = useState(""), [createShared, setCreateShared] = useState(false);
  const [createSeverity, setCreateSeverity] = useState("NORMAL"), [category, setCategory] = useState("OTHER"), [severity, setSeverity] = useState("NORMAL"), [status, setStatus] = useState("OPEN"), [assignee, setAssignee] = useState("");
  const alert = useRef<HTMLParagraphElement>(null), identity = useRef<{ payload: string; key: string } | null>(null);
  const revoke = () => { setDenied(true); setThread(null); setTickets([]); setReply(""); setReplyRefs(""); setNote(""); setSubject(""); setBody(""); setCreateRefs(""); };
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => {
    if (!selected || denied) return;
    const controller = new AbortController();
    void (async () => { try {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setThread(null); setLoading(true);
      const response = await fetch(`${apiBase}/${selected}`, { signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { if ([401, 403].includes(response.status)) revoke(); throw new Error(result.error?.message ?? "Request could not be loaded."); }
      setThread(result); setStatus(result.ticket.status); setSeverity(result.ticket.severity); setAssignee(result.ticket.assigneeId ?? "");
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Request could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); } })();
    return () => controller.abort();
  }, [selected, refresh, apiBase, denied]);
  async function reload() {
    setLoading(true); setError("");
    try { const response = await fetch(apiBase, { cache: "no-store" }); const result = await response.json();
      if (!response.ok) { if ([401, 403].includes(response.status)) revoke(); throw new Error(result.error?.message ?? "Support requests could not be loaded."); }
      setTickets(result.tickets); setHasMore(Boolean(result.hasMore)); setDenied(false); setRefresh(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Support requests could not be loaded."); } finally { setLoading(false); }
  }
  async function submit(action: string, content: Record<string, unknown>, creating = false) {
    if (busy || denied) return;
    if (Array.isArray(content.evidenceRefs) && (content.evidenceRefs.length > 10 || content.evidenceRefs.some(r => typeof r !== "string" || r.length > 200))) { setError("Use up to 10 evidence references, each at most 200 characters."); return; }
    const payload = { ...content, ...(creating ? {} : { action, expectedRevision: thread?.ticket.revision }) };
    const fingerprint = JSON.stringify({ selected: creating ? null : selected, payload });
    if (identity.current?.payload !== fingerprint) identity.current = { payload: fingerprint, key: crypto.randomUUID() };
    setBusy(true); setError("");
    const result = await postJson<{ id: string }>(creating ? apiBase : `${apiBase}/${selected}`, { ...payload, idempotencyKey: identity.current.key });
    setBusy(false);
    if (!result.ok || !result.data) { if (result.status === 401 || result.status === 403) revoke(); setError(result.error ?? "Support request could not be saved."); return; }
    identity.current = null;
    if (creating) { setSubject(""); setBody(""); setCreateRefs(""); setCreateShared(false); setSelected(result.data.id); }
    else if (action === "reply") { setReply(""); setReplyRefs(""); setShared(false); }
    else if (action === "note") setNote("");
    setRefresh(v => v + 1); await reload();
  }
  function messages(visibility: "CUSTOMER" | "INTERNAL") { return thread?.messages.filter(message => message.visibility === visibility).map(message => <article key={message.id} className="rounded-box border p-3 space-y-2"><p className="text-xs text-muted-foreground">{message.actorId === currentUserId ? "You" : visibility === "INTERNAL" ? "Staff" : "Participant"} · {message.action} · {message.createdAt}</p>{message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}{message.evidenceRefs.length > 0 && <div className="text-sm"><p className="font-medium">Submitted references</p>{message.evidenceRefs.map((ref, i) => <p className="break-all whitespace-pre-wrap" key={i}>{ref}</p>)}</div>}</article>); }
  return <section className="mt-6 space-y-5 min-w-0">
    {error && <p ref={alert} tabIndex={-1} role="alert" className="rounded-box border border-destructive p-3 text-sm">{error}</p>}
    <button type="button" className={button} onClick={reload} disabled={busy || loading}>{denied ? "Retry access" : "Reload requests"}</button>
    {!denied && <><div className="panel space-y-3 p-4"><h2 className="text-lg font-medium">Recent requests</h2><label className="block text-sm">Select a request<select aria-label="Select a request" className={field} value={selected} disabled={busy} onChange={e => { if ((reply || note) && !window.confirm("Discard the draft when switching requests?")) return; setSelected(e.target.value); setReply(""); setReplyRefs(""); setNote(""); setShared(false); setError(""); }}><option value="">Choose a request</option>{tickets.map(ticket => <option key={ticket.id} value={ticket.id}>{ticket.category} · {ticket.status} · {ticket.id}</option>)}</select></label>{!tickets.length && <p className="text-sm text-muted-foreground">No recent requests available.</p>}{hasMore && <p className="text-sm text-muted-foreground">Showing the most recent 100 requests. An older saved request link can still open its thread.</p>}</div>
    {loading && <p role="status">Loading support request…</p>}
    {thread && <div className="panel p-4 space-y-5 min-w-0"><h2 className="break-words text-xl font-medium">{thread.ticket.subject}</h2><p className="text-sm">{thread.ticket.status} · {thread.ticket.severity} · revision {thread.ticket.revision}</p><div className="space-y-3">{messages("CUSTOMER")}</div>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("reply", { body: reply.trim(), evidenceRefs: references(replyRefs) }); }}><label htmlFor="support-reply" className="block text-sm">Reply message</label><textarea id="support-reply" required maxLength={2000} className={field} value={reply} onChange={e => setReply(e.target.value)} /><label className="block text-sm">Reply evidence references (one per line)<textarea aria-label="Reply evidence references (one per line)" className={field} value={replyRefs} onChange={e => setReplyRefs(e.target.value)} /></label>{mode === "requester" && <label className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} required />I intend to share this reply and its references with platform support</label>}<button className={button} disabled={busy || !reply.trim() || (mode === "requester" && !shared)}>Send reply</button></form>
      {mode === "requester" ? <button type="button" className={button} disabled={busy || thread.ticket.status === "RESOLVED"} onClick={() => void submit("close", {})}>Resolve my request</button> : <><h3 className="text-lg font-medium">Internal staff notes</h3><div className="space-y-3">{messages("INTERNAL")}</div><form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("note", { body: note.trim(), evidenceRefs: [] }); }}><label htmlFor="support-note" className="block text-sm">Internal note</label><textarea id="support-note" required maxLength={2000} className={field} value={note} onChange={e => setNote(e.target.value)} /><button className={button} disabled={busy || !note.trim()}>Save internal note</button></form><form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("triage", { status, severity, assigneeId: assignee.trim() || null }); }}><h3 className="text-lg font-medium">Staff triage</h3><label className="block text-sm">Status<select aria-label="Status" className={field} value={status} onChange={e => setStatus(e.target.value)}>{["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"].map(value => <option key={value}>{value}</option>)}</select></label><label className="block text-sm">Severity<select aria-label="Severity" className={field} value={severity} onChange={e => setSeverity(e.target.value)}><option>NORMAL</option><option>URGENT</option></select></label><label className="block text-sm">Allowlisted admin account UUID (optional)<input className={field} value={assignee} onChange={e => setAssignee(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" /></label><button className={button} disabled={busy}>Save triage</button></form></>}
    </div>}
    {mode === "requester" && <form className="panel p-4 space-y-3" onSubmit={e => { e.preventDefault(); void submit("create", { subject: subject.trim(), body: body.trim(), category, severity: createSeverity, evidenceRefs: references(createRefs) }, true); }}><h2 className="text-lg font-medium">New support request</h2><label className="block text-sm">Subject<input required maxLength={160} className={field} value={subject} onChange={e => setSubject(e.target.value)} /></label><label className="block text-sm">Category<select aria-label="Category" className={field} value={category} onChange={e => setCategory(e.target.value)}>{["ACCOUNT", "IMPORT", "REVIEW", "OTHER"].map(value => <option key={value}>{value}</option>)}</select></label><label className="block text-sm">Request severity<select aria-label="Request severity" className={field} value={createSeverity} onChange={e => setCreateSeverity(e.target.value)}><option>NORMAL</option><option>URGENT</option></select></label><label className="block text-sm">Message<textarea aria-label="Message" required maxLength={2000} className={field} value={body} onChange={e => setBody(e.target.value)} /></label><label className="block text-sm">Evidence references (one per line)<textarea aria-label="Evidence references (one per line)" className={field} value={createRefs} onChange={e => setCreateRefs(e.target.value)} /></label><p className="text-sm text-muted-foreground">References are submitted as text. Include only evidence you intend support staff to inspect.</p><label className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" required checked={createShared} onChange={e => setCreateShared(e.target.checked)} />I intend to share this message and its references with platform support</label><button className={button} disabled={busy || !createShared || !subject.trim() || !body.trim()}>Submit request</button></form>}</>}
  </section>;
}
