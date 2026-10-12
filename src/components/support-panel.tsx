"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api";
import type { SupportThread, SupportTicketMeta } from "@/core/support";

type Props = { mode: "requester" | "staff"; apiBase: string; initialTickets: SupportTicketMeta[]; initialHasMore?: boolean; initialTicketId?: string | null; initialError?: string | null; currentUserId: string };
const field = "w-full min-w-0 min-h-9 rounded-field border border-field-border bg-white px-3 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:min-h-11 max-sm:text-base";
const button = "inline-flex min-h-9 items-center justify-center rounded-field border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50 max-sm:min-h-11";
const primary = "inline-flex min-h-9 items-center justify-center rounded-field border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50 max-sm:min-h-11";
const labelText = "block text-[13px] font-medium";
const CATEGORY_LABELS: Record<string, string> = { ACCOUNT: "Account and team", IMPORT: "Import and data", REVIEW: "Review and calculation", OTHER: "Something else" };
const STATUS_LABELS: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_CUSTOMER: "Waiting on you", RESOLVED: "Resolved" };
const stamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} UTC`; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }); };
const chip = (status: string) => `inline-flex items-center rounded-chip border px-1.5 text-xs leading-5 font-medium whitespace-nowrap ${status === "RESOLVED" ? "border-transparent bg-success-soft text-success" : status === "WAITING_CUSTOMER" ? "border-transparent bg-signal/10 text-signal" : "border-border text-muted-foreground"}`;
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
  function messages(visibility: "CUSTOMER" | "INTERNAL") { return thread?.messages.filter(message => message.visibility === visibility).map(message => <article key={message.id} className="space-y-1.5 rounded-field border border-border p-3"><p className="text-xs text-muted-foreground">{message.actorId === currentUserId ? "You" : visibility === "INTERNAL" ? "Staff" : "Participant"} · {message.action} · <time dateTime={message.createdAt} title={message.createdAt} suppressHydrationWarning>{stamp(message.createdAt)}</time></p>{message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}{message.evidenceRefs.length > 0 && <div className="text-sm"><p className="font-medium">Submitted references</p>{message.evidenceRefs.map((ref, i) => <p className="break-all whitespace-pre-wrap" key={i}>{ref}</p>)}</div>}</article>); }
  function pick(id: string) { if (id === selected) return; if ((reply || note) && !window.confirm("Discard the draft when switching requests?")) return; setSelected(id); setReply(""); setReplyRefs(""); setNote(""); setShared(false); setError(""); }
  const head = "flex flex-wrap items-center gap-2 border-b border-border px-4 py-3";
  const createForm = mode === "requester" && <form className="rounded-card border border-border bg-card" aria-labelledby="support-new-heading" onSubmit={e => { e.preventDefault(); void submit("create", { subject: subject.trim(), body: body.trim(), category, severity: createSeverity, evidenceRefs: references(createRefs) }, true); }}><div className={head}><h2 id="support-new-heading" className="text-sm font-medium">New support request</h2></div><div className="grid gap-3.5 p-4"><label className="grid gap-1.5"><span className={labelText}>Subject</span><input required maxLength={160} className={field} value={subject} onChange={e => setSubject(e.target.value)} /></label><label className="grid gap-1.5"><span className={labelText}>Category</span><select aria-label="Category" className={field} value={category} onChange={e => setCategory(e.target.value)}>{["ACCOUNT", "IMPORT", "REVIEW", "OTHER"].map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label><label className="grid gap-1.5"><span className={labelText}>Request severity</span><select aria-label="Request severity" className={field} value={createSeverity} onChange={e => setCreateSeverity(e.target.value)}><option>NORMAL</option><option>URGENT</option></select></label><label className="grid gap-1.5"><span className={labelText}>What happened?</span><textarea aria-label="Message" required maxLength={2000} rows={4} className={field} placeholder="What you expected, what you saw, and which page" value={body} onChange={e => setBody(e.target.value)} /><small className="text-xs text-muted-foreground">Use worker codes like W014, not names or amounts.</small></label><label className="grid gap-1.5"><span className={labelText}>Evidence references (one per line)</span><textarea aria-label="Evidence references (one per line)" rows={2} className={field} value={createRefs} onChange={e => setCreateRefs(e.target.value)} /></label><p className="text-xs text-muted-foreground">References are submitted as text. Include only evidence you intend support staff to inspect. Never include passwords, codes, wallet recovery files or raw payroll files.</p><label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" required className="mt-1 size-4 accent-[var(--primary)]" checked={createShared} onChange={e => setCreateShared(e.target.checked)} />I intend to share this message and its references with platform support</label><button className={`${primary} w-full`} disabled={busy || !createShared || !subject.trim() || !body.trim()}>Submit request</button></div></form>;
  return <div className={mode === "requester" ? "mt-6 grid min-w-0 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_21.25rem]" : "mt-6 min-w-0"}>
    <section className="flex min-w-0 flex-col gap-4" aria-label="Support requests">
    {error && <p ref={alert} tabIndex={-1} role="alert" className="rounded-field border border-signal bg-signal/10 p-3 text-sm">{error}</p>}
    {!denied && <><div className="rounded-card border border-border bg-card"><div className={head}><h2 className="text-sm font-medium">{mode === "requester" ? "My tickets" : "Recent requests"}</h2><span className="text-xs text-muted-foreground">{tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}</span><button type="button" className={`${button} ml-auto min-h-8 px-3 text-xs`} onClick={reload} disabled={busy || loading}>Reload requests</button></div>{tickets.length > 0 ? <ul className="m-0 list-none p-0" aria-label="Select a request">{tickets.map(ticket => <li key={ticket.id} className="border-b border-border last:border-b-0"><button type="button" aria-current={ticket.id === selected ? "true" : undefined} disabled={busy} onClick={() => pick(ticket.id)} className={`flex w-full min-w-0 flex-col gap-1 px-4 py-2.5 text-left hover:bg-[#FAFAF9] max-sm:min-h-11 ${ticket.id === selected ? "bg-accent/60" : ""}`}><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{CATEGORY_LABELS[ticket.category] ?? ticket.category}</span><span className={`${chip(ticket.status)} ml-auto`}>{STATUS_LABELS[ticket.status] ?? ticket.status}</span></span><span className="break-all text-xs text-muted-foreground">Request {ticket.id.slice(0, 8)} · {ticket.severity === "URGENT" ? "Urgent · " : ""}updated <time dateTime={ticket.updatedAt} suppressHydrationWarning>{day(ticket.updatedAt)}</time></span></button></li>)}</ul> : <p className="px-4 py-6 text-sm text-muted-foreground">No recent requests available.</p>}{hasMore && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Showing the most recent 100 requests. An older saved request link can still open its thread.</p>}</div>
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading support request…</p>}
    {thread && <div className="min-w-0 space-y-5 rounded-card border border-border bg-card p-4"><div className="flex flex-wrap items-start gap-2"><h2 className="min-w-0 flex-1 break-words text-lg font-medium">{thread.ticket.subject}</h2><span className={chip(thread.ticket.status)}>{STATUS_LABELS[thread.ticket.status] ?? thread.ticket.status}</span></div><p className="text-xs text-muted-foreground">{thread.ticket.status} · {thread.ticket.severity} · revision {thread.ticket.revision}</p><div className="space-y-3">{messages("CUSTOMER")}</div>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("reply", { body: reply.trim(), evidenceRefs: references(replyRefs) }); }}><label htmlFor="support-reply" className={labelText}>Reply message</label><textarea id="support-reply" required maxLength={2000} rows={3} className={field} value={reply} onChange={e => setReply(e.target.value)} /><label className="block text-sm">Reply evidence references (one per line)<textarea aria-label="Reply evidence references (one per line)" className={`${field} mt-1.5`} value={replyRefs} onChange={e => setReplyRefs(e.target.value)} /></label>{mode === "requester" && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={shared} onChange={e => setShared(e.target.checked)} required />I intend to share this reply and its references with platform support</label>}<div className="flex flex-wrap gap-2"><button className={primary} disabled={busy || !reply.trim() || (mode === "requester" && !shared)}>Send reply</button>{mode === "requester" && <button type="button" className={button} disabled={busy || thread.ticket.status === "RESOLVED"} onClick={() => void submit("close", {})}>Resolve my request</button>}</div></form>
      {mode === "staff" && <><h3 className="text-base font-medium">Internal staff notes</h3><div className="space-y-3">{messages("INTERNAL")}</div><form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("note", { body: note.trim(), evidenceRefs: [] }); }}><label htmlFor="support-note" className={labelText}>Internal note</label><textarea id="support-note" required maxLength={2000} className={field} value={note} onChange={e => setNote(e.target.value)} /><button className={button} disabled={busy || !note.trim()}>Save internal note</button></form><form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit("triage", { status, severity, assigneeId: assignee.trim() || null }); }}><h3 className="text-base font-medium">Staff triage</h3><label className="block text-sm">Status<select aria-label="Status" className={field} value={status} onChange={e => setStatus(e.target.value)}>{["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"].map(value => <option key={value}>{value}</option>)}</select></label><label className="block text-sm">Severity<select aria-label="Severity" className={field} value={severity} onChange={e => setSeverity(e.target.value)}><option>NORMAL</option><option>URGENT</option></select></label><label className="block text-sm">Allowlisted admin account UUID (optional)<input className={field} value={assignee} onChange={e => setAssignee(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" /></label><button className={button} disabled={busy}>Save triage</button></form></>}
    </div>}</>}
    {denied && <div className="rounded-card border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Your access to these requests changed.</p><button type="button" className={`${button} mt-3`} onClick={reload} disabled={busy || loading}>Retry access</button></div>}
    </section>
    {mode === "requester" && <div className="flex min-w-0 flex-col gap-4">{!denied && createForm}<p className="rounded-card border border-border bg-secondary px-3.5 py-3 text-sm text-muted-foreground">Urgent payment concern? Ask an Owner or payment approver to switch <b className="font-medium text-foreground">Live payments OFF</b> in Payments, then contact us. Support response times are not set yet.</p></div>}
  </div>;
}
