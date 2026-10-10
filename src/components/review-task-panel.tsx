"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api";
import { ReviewTaskCommandSchema, type ReviewTask, type ReviewTaskSource } from "@/core/workflow/review-tasks";

type Queue = { tasks: ReviewTask[]; assignees: { id: string; roles: string[] }[]; sources: ReviewTaskSource[] };
const control = "w-full min-w-0 min-h-11 rounded-field border bg-background px-3 py-2 text-sm";
const button = "min-h-11 rounded-field border px-4 py-2 text-sm disabled:opacity-50";
function sourceLabel(source: ReviewTaskSource) { return source.kind === "EXCEPTION" ? `Exception ${source.exceptionId}` : `Missing ${source.importType.toLowerCase().replaceAll("_", " ")}`; }

export function ReviewTaskPanel({ runId }: { runId: string }) {
  const [queue, setQueue] = useState<Queue | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [taskId, setTaskId] = useState(""), [source, setSource] = useState(""), [assigneeId, setAssigneeId] = useState(""), [dueAt, setDueAt] = useState(""), [severity, setSeverity] = useState("MEDIUM"), [status, setStatus] = useState("OPEN"), [nextAction, setNextAction] = useState(""), [refs, setRefs] = useState("");
  const alert = useRef<HTMLParagraphElement>(null), pending = useRef<{ fingerprint: string; command: unknown } | null>(null), newId = useRef<string | null>(null);
  const endpoint = `/api/runs/${runId}/tasks`;
  const active = queue?.tasks.find(task => task.taskId === taskId);
  const redact = () => { setQueue(null); setDenied(true); setTaskId(""); setSource(""); setAssigneeId(""); setDueAt(""); setNextAction(""); setRefs(""); pending.current = null; };
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  async function load(signal?: AbortSignal) {
    await Promise.resolve();
    if (signal?.aborted) return;
    setLoading(true);
    try { const response = await fetch(endpoint, { signal, cache: "no-store" }); const result = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) { if ([401, 403].includes(response.status)) redact(); throw new Error(result.error?.message ?? "Review tasks could not be loaded."); }
      setQueue(result); setDenied(false);
    } catch (e) { if (!signal?.aborted) { setQueue(null); setError(e instanceof Error ? e.message : "Review tasks could not be loaded."); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); /* The keyed run page remounts on company/run changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  function select(id: string) {
    const dirty = active ? nextAction !== active.nextAction || refs !== active.evidenceRefs.join("\n") || assigneeId !== active.assigneeId || dueAt !== active.dueAt || severity !== active.severity || status !== active.status : Boolean(nextAction || refs || dueAt || assigneeId || source);
    if (dirty && !window.confirm("Discard the current task draft?")) return;
    const task = queue?.tasks.find(item => item.taskId === id); setTaskId(id); setSource(""); setAssigneeId(task?.assigneeId ?? ""); setDueAt(task?.dueAt ?? ""); setSeverity(task?.severity ?? "MEDIUM"); setStatus(task?.status ?? "OPEN"); setNextAction(task?.nextAction ?? ""); setRefs(task?.evidenceRefs.join("\n") ?? ""); setError(""); pending.current = null; newId.current = null;
  }
  async function save() {
    if (!queue || denied || busy) return;
    newId.current ??= crypto.randomUUID();
    const content = { action: active ? "update" : "create", taskId: active?.taskId ?? newId.current, expectedRevision: active?.revision ?? 0, assigneeId, dueAt: dueAt.trim(), severity, status: active ? status : "OPEN", nextAction: nextAction.trim(), evidenceRefs: refs.split("\n").map(ref => ref.trim()).filter(Boolean), ...(active ? {} : { source: queue.sources[Number(source)] }) };
    const fingerprint = JSON.stringify(content);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, command: { ...content, idempotencyKey: crypto.randomUUID() } };
    const checked = ReviewTaskCommandSchema.safeParse(pending.current.command);
    if (!checked.success) { setError(checked.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")); return; }
    setBusy(true); setError(""); const response = await postJson(endpoint, checked.data); setBusy(false);
    if (!response.ok) { if ([401, 403].includes(response.status ?? 0)) redact(); setError(response.error ?? "Task could not be saved."); return; }
    pending.current = null; newId.current = null; setTaskId(""); setNextAction(""); setRefs(""); setAssigneeId(""); setDueAt(""); setSource(""); setStatus("OPEN"); await load();
  }
  return <section className="mt-6 panel space-y-4 min-w-0"><h2 id="review-tasks-heading" className="text-lg scroll-mt-20">Review tasks</h2><p className="text-sm text-muted-foreground">Assign review work and record follow-up evidence. Resolving a task does not resolve its source exception or change payroll readiness.</p>
    {error && <p role="alert" tabIndex={-1} ref={alert} className="rounded-box border border-destructive p-3 text-sm break-words">{error}</p>}
    <button type="button" className={button} disabled={busy || loading} onClick={() => { setError(""); void load(); }}>{denied ? "Retry task access" : "Reload task evidence"}</button>
    {loading && <p role="status">Loading review tasks…</p>}
    {queue && !denied && <><label className="block text-sm">Task<select aria-label="Task" className={control} disabled={busy} value={taskId} onChange={e => select(e.target.value)}><option value="">New task</option>{queue.tasks.map(task => <option key={task.taskId} value={task.taskId}>{task.status} · {sourceLabel(task.source)} · {task.taskId}</option>)}</select></label>{queue.tasks.length === 0 && <p className="text-sm text-muted-foreground">No review tasks recorded.</p>}
      {active && <div className="rounded-box border p-3 space-y-3"><p className="text-sm break-all">{sourceLabel(active.source)} · revision {active.revision}</p>{!active.assigneeAvailable && <p className="text-sm text-signal">The historical assignee is unavailable. Select a current reviewer before saving.</p>}<details><summary className="min-h-11 py-3 cursor-pointer text-sm">Recorded task history</summary>{active.history.map(event => <article key={event.id} className="border-t py-3 text-sm space-y-1"><p>{event.status} · {event.severity} · revision {event.revision}</p><p className="break-all">Assignee {event.assigneeId} · due {event.dueAt} · recorded {event.at}</p><p className="whitespace-pre-wrap break-words">{event.nextAction}</p>{event.evidenceRefs.map((ref, i) => <p className="break-all whitespace-pre-wrap" key={i}>{ref}</p>)}</article>)}</details></div>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>{!active && <label className="block text-sm">Task source<select aria-label="Task source" required className={control} value={source} onChange={e => setSource(e.target.value)}><option value="">Choose current evidence</option>{queue.sources.map((item, i) => <option key={i} value={i}>{sourceLabel(item)}</option>)}</select></label>}
        <label className="block text-sm">Assignee<select aria-label="Assignee" required className={control} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">Choose a current reviewer</option>{active && !active.assigneeAvailable && <option value={active.assigneeId} disabled>Unavailable reviewer {active.assigneeId}</option>}{queue.assignees.map(actor => <option key={actor.id} value={actor.id}>{actor.id} · {actor.roles.join(", ")}</option>)}</select></label>
        <label className="block text-sm">Due date and time with UTC offset<input aria-label="Due date and time with UTC offset" required className={control} value={dueAt} placeholder="2026-10-08T17:00:00+06:00" onChange={e => setDueAt(e.target.value)} /></label><p className="text-xs text-muted-foreground">Enter the intended timezone explicitly, for example +06:00 or Z.</p>
        <label className="block text-sm">Task severity<select aria-label="Task severity" className={control} value={severity} onChange={e => setSeverity(e.target.value)}>{["LOW", "MEDIUM", "HIGH"].map(value => <option key={value}>{value}</option>)}</select></label>
        {active && <label className="block text-sm">Task status<select aria-label="Task status" className={control} value={status} onChange={e => setStatus(e.target.value)}>{["OPEN", "IN_PROGRESS", "RESOLVED"].map(value => <option key={value}>{value}</option>)}</select></label>}
        <label htmlFor="task-next-action" className="block text-sm">Next action</label><textarea id="task-next-action" required maxLength={2000} className={control} value={nextAction} onChange={e => setNextAction(e.target.value)} /><label className="block text-sm">Task evidence references (one per line)<textarea aria-label="Task evidence references (one per line)" className={control} value={refs} onChange={e => setRefs(e.target.value)} /></label><p className="text-xs text-muted-foreground">Up to 20 unique text references, each at most 500 characters. References are never fetched.</p><button className={button} disabled={busy || loading || !nextAction.trim() || !assigneeId || (!active && (!source || !queue.sources.length)) || !queue.assignees.some(actor => actor.id === assigneeId)}>{active ? "Save task update" : "Create review task"}</button>
      </form></>}
  </section>;
}
