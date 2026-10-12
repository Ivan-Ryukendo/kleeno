"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { CalendarDateSchema } from "@/core/workers";
import { EffectiveRateSchema, ScheduleCompensationSchema } from "@/core/workers/effective-compensation";
import { formatUsdc, parseUsdc } from "@/core/money";
import { postJson } from "@/lib/api";
import { EffectivePayPreview } from "@/components/effective-compensation-preview";
import type { CompensationPreview } from "@/core/workers/effective-compensation";

const ViewSchema = z.object({ workerId: z.string().uuid(), active: z.boolean(), revision: z.number().int().nonnegative(), baseline: EffectiveRateSchema, history: z.array(EffectiveRateSchema.extend({ actor: z.string(), at: z.string(), reason: z.string(), source: z.string() })), impacts: z.array(z.object({ id: z.string().uuid(), status: z.string(), period_start: CalendarDateSchema, period_end: CalendarDateSchema })), segments: z.unknown().nullable() });
export type ScheduleView = z.infer<typeof ViewSchema>;
interface Draft { effectiveFrom: string; base: string; hourly: string; reason: string; source: string; supersedesId: string }
const leaves = (view: ScheduleView, date: string) => view.history.filter(row => row.effectiveFrom === date && !view.history.some(next => next.supersedesId === row.id));
export function scheduleCommand(view: ScheduleView, reviewedDate: string, draft: Draft, idempotencyKey: string) {
  if (reviewedDate !== draft.effectiveFrom) throw new Error("Review affected periods for the current effective date before saving.");
  if (!view.active) throw new Error("Inactive workers cannot receive a new compensation schedule.");
  const active = leaves(view, draft.effectiveFrom);
  if ((active.length && (!draft.supersedesId || !active.some(row => row.id === draft.supersedesId))) || (!active.length && draft.supersedesId)) throw new Error("Select the current same-date schedule to replace, or choose a new date.");
  return ScheduleCompensationSchema.parse({ effectiveFrom: draft.effectiveFrom, payType: view.baseline.payType, baseAmount: parseUsdc(draft.base).toString(), hourlyRate: parseUsdc(draft.hourly).toString(), expectedRevision: view.revision, baselineCompensationId: view.baseline.id, baselineCompensationVersion: view.baseline.version, supersedesId: draft.supersedesId || null, reason: draft.reason, source: draft.source, impactedRunIds: view.impacts.map(run => run.id), idempotencyKey });
}
const amount = (value: string) => formatUsdc(BigInt(value));
const initialDraft: Draft = { effectiveFrom: "", base: "", hourly: "0", reason: "", source: "", supersedesId: "" };

export function EffectiveCompensationForm({ workerId, workerCode }: { workerId: string; workerCode: string }) {
  const router = useRouter(), headingId = `schedule-${workerId}`;
  const [draft, setDraft] = useState<Draft>(initialDraft), [view, setView] = useState<ScheduleView | null>(null), [reviewedDate, setReviewedDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const requestSeq = useRef(0), retry = useRef<{ fingerprint: string; key: string } | null>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const report = (message: string) => { setError(message); };
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  let previewProposal: Omit<CompensationPreview, "runId"> | null = null;
  if (view && reviewedDate) {
    try {
      const command = scheduleCommand(view, reviewedDate, draft, "00000000-0000-4000-8000-000000000001");
      previewProposal = { effectiveFrom: command.effectiveFrom, payType: command.payType, baseAmount: command.baseAmount, hourlyRate: command.hourlyRate, expectedRevision: command.expectedRevision, baselineCompensationId: command.baselineCompensationId, baselineCompensationVersion: command.baselineCompensationVersion, supersedesId: command.supersedesId };
    } catch { /* An incomplete or stale draft offers no monetary preview. */ }
  }
  const edit = (key: keyof Draft, value: string) => { setDraft(current => ({ ...current, [key]: value, ...(key === "effectiveFrom" ? { supersedesId: "" } : {}) })); setNote(null); if (key === "effectiveFrom") { requestSeq.current++; setReviewedDate(null); } };
  async function review() {
    const date = draft.effectiveFrom, seq = ++requestSeq.current;
    if (!CalendarDateSchema.safeParse(date).success) { report("Choose a valid effective date before reviewing affected periods."); return; }
    setBusy(true); setError(null); setNote(null); setReviewedDate(null);
    try {
      const response = await fetch(`/api/workers/${workerId}/effective-compensation?${new URLSearchParams({ effectiveFrom: date })}`, { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (seq !== requestSeq.current) return;
      if (!response.ok) {
        setView(null);
        if (response.status === 401 || response.status === 403 || response.status === 404) setDenied(true);
        throw new Error(json?.error?.message ? `${json.error.message}${json.correlationId ? ` (support code ${json.correlationId})` : ""}` : "Schedule evidence could not be loaded. Check current access and retry.");
      }
      const loaded = ViewSchema.parse(json);
      if (loaded.workerId !== workerId) throw new Error("Worker evidence changed. Reload before scheduling.");
      setView(loaded); setReviewedDate(date); setDenied(false);
      // Keep an existing draft after stale-write/network failures.
      if (!draft.base) {
        const current = loaded.history.filter(row => row.effectiveFrom <= date && !loaded.history.some(next => next.supersedesId === row.id)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1) ?? loaded.baseline;
        setDraft(previous => ({ ...previous, base: amount(current.baseAmount), hourly: amount(current.hourlyRate) }));
      }
    } catch (caught) {
      if (seq !== requestSeq.current) return;
      setView(null); report(caught instanceof z.ZodError ? "Schedule evidence is incomplete. Reload before scheduling." : caught instanceof Error ? caught.message : "Schedule evidence could not be loaded.");
    } finally { if (seq === requestSeq.current) setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setNote(null);
    if (!view || !reviewedDate) { report("Review affected periods before scheduling pay."); return; }
    let command;
    try {
      const candidate = scheduleCommand(view, reviewedDate, draft, crypto.randomUUID());
      const fingerprint = JSON.stringify({ ...candidate, idempotencyKey: "" });
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: candidate.idempotencyKey };
      command = { ...candidate, idempotencyKey: retry.current.key };
    } catch (caught) { report(caught instanceof z.ZodError ? "Check amounts, reason and source. Amounts must be non-negative USDC with at most six decimal places and within the supported limit." : caught instanceof Error ? caught.message : "Check the schedule fields."); return; }
    setBusy(true);
    const result = await postJson(`/api/workers/${workerId}/effective-compensation`, command);
    if (result.ok) {
      retry.current = null; setReviewedDate(null); setView(null);
      setNote("Compensation schedule saved. Existing captured calculations remain unchanged. Review current history before another change."); router.refresh();
    } else {
      if (result.status === 401 || result.status === 403 || result.status === 404) { setDenied(true); setView(null); setReviewedDate(null); }
      if (result.status === 409) setReviewedDate(null);
      report(result.error ?? "Could not save compensation. Your draft is retained; reload the impact review before retrying.");
    }
    setBusy(false);
  }
  return <section aria-labelledby={headingId} className="space-y-4 rounded-box border border-border bg-background p-4 sm:p-5">
    <h3 id={headingId} className="text-base font-medium">Schedule pay for {workerCode}</h3>
    <p className="text-sm text-muted-foreground">Choose when a reviewed rate takes effect. Split salaried and retainer periods require approved calendar-day proration and use active days divided by whole-period days, rounded per segment. Scheduling does not approve a policy. Hourly caps consume actual work dates in order. Pooled overtime approvals and inferred missing-time leave block split calculation when their actual dates cannot be established; whole-period rates retain existing reviewed-input rules.</p>
    {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-field border border-signal p-3 text-sm text-signal focus-visible:outline-2 focus-visible:outline-primary">{error}</p>}
    {note && <p role="status" className="text-sm">{note}</p>}
    {denied ? <p className="text-sm">Current worker access changed. Scheduling and pay history are hidden. Reload the Workers page after checking your membership.</p> : <form onSubmit={save} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="sm:flex-1"><Label htmlFor={`${headingId}-date`}>Effective date</Label><Input id={`${headingId}-date`} type="date" required disabled={busy} value={draft.effectiveFrom} onChange={event => edit("effectiveFrom", event.target.value)} /></div><Button type="button" variant="outline" disabled={busy || !draft.effectiveFrom} className="min-h-11" onClick={review}>{busy ? "Working…" : "Review affected periods"}</Button></div>
      {!view && <p className="text-sm text-muted-foreground">History and affected periods have not been loaded. No pay change can be saved yet.</p>}
      {view && <>
        <div className="rounded-field border border-border p-3 text-sm"><p>Pinned original pay: v{view.baseline.version} · {view.baseline.payType} · {amount(view.baseline.baseAmount)} USDC per period · {amount(view.baseline.hourlyRate)} USDC/hour.</p><p className="mt-1 text-muted-foreground">Schedule revision {view.revision}. {reviewedDate === draft.effectiveFrom ? `Impact review for ${reviewedDate}.` : "The effective date changed. Review affected periods again before saving."}</p></div>
        <section aria-labelledby={`${headingId}-impact`}><h4 id={`${headingId}-impact`} className="text-sm font-medium">Potentially affected company periods</h4><p className="mt-1 text-sm text-muted-foreground">All company periods ending on or after this date are listed; this does not establish worker inclusion. Existing captured periods keep their original result. Corrections require a separate linked review. Scheduling never recalculates approved records or pays automatically.</p>{reviewedDate !== draft.effectiveFrom ? <p className="mt-2 text-sm">Current-date impacts are unavailable until refreshed.</p> : view.impacts.length === 0 ? <p className="mt-2 text-sm">No existing company periods end on or after this date.</p> : <ul className="mt-2 space-y-2 text-sm">{view.impacts.map(run => <li key={run.id} className="flex flex-wrap items-center gap-2"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/runs/${run.id}`}>{run.period_start} – {run.period_end}</Link><span>{run.status.replaceAll("_", " ")}</span></li>)}</ul>}</section>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`${headingId}-base`}>Base or retainer per period (USDC)</Label><Input id={`${headingId}-base`} inputMode="decimal" value={draft.base} disabled={busy} pattern="\d+(\.\d{1,6})?" required onChange={event => edit("base", event.target.value)} /></div><div><Label htmlFor={`${headingId}-hourly`}>Hourly or approved-extra rate (USDC)</Label><Input id={`${headingId}-hourly`} inputMode="decimal" value={draft.hourly} disabled={busy} pattern="\d+(\.\d{1,6})?" required onChange={event => edit("hourly", event.target.value)} /></div><div><Label htmlFor={`${headingId}-reason`}>Reason for change</Label><Input id={`${headingId}-reason`} value={draft.reason} disabled={busy} maxLength={2000} required onChange={event => edit("reason", event.target.value)} /></div><div><Label htmlFor={`${headingId}-source`}>Approved source reference</Label><Input id={`${headingId}-source`} value={draft.source} disabled={busy} maxLength={500} required onChange={event => edit("source", event.target.value)} /></div></div>
        {leaves(view, draft.effectiveFrom).length > 0 && <div><Label htmlFor={`${headingId}-replacement`}>Replace an existing schedule on this date</Label><Select id={`${headingId}-replacement`} value={draft.supersedesId} disabled={busy} required onChange={event => edit("supersedesId", event.target.value)}><option value="">Choose the reviewed same-date schedule</option>{leaves(view, draft.effectiveFrom).map(row => <option key={row.id} value={row.id}>Revision {row.version} · {amount(row.baseAmount)} / period · {amount(row.hourlyRate)} / hour</option>)}</Select><p className="mt-2 text-sm text-muted-foreground">The earlier revision stays in immutable history.</p></div>}
        <p className="text-sm text-muted-foreground">Pay type stays {view.baseline.payType}. Percentage deductions apply once to combined gross; fixed deductions and one-off additions apply once per period. Source references must contain no employee names or account details.</p>
        <EffectivePayPreview key={JSON.stringify({ draft, revision: view.revision, reviewedDate })} workerId={workerId} periods={reviewedDate === draft.effectiveFrom ? view.impacts : []} proposal={previewProposal} onDenied={message => { setDenied(true); setView(null); setReviewedDate(null); report(message); }} />
        <Button type="submit" disabled={busy || !view.active || reviewedDate !== draft.effectiveFrom} className="min-h-11">Save reviewed schedule</Button>
        {!view.active && <p className="text-sm">This worker is inactive. Schedule changes are unavailable.</p>}
        <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">Immutable scheduled history ({view.history.length})</summary>{view.history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No effective-dated compensation has been scheduled.</p> : <ul className="mt-3 space-y-3 text-sm">{view.history.map(row => <li key={row.id} className="break-words"><p>Revision {row.version} · Effective {row.effectiveFrom} · {amount(row.baseAmount)} USDC per period · {amount(row.hourlyRate)} USDC/hour{view.history.some(next => next.supersedesId === row.id) ? " · Superseded" : ""}</p><p className="text-muted-foreground">{row.reason} · Source: {row.source}</p><p className="text-xs text-muted-foreground">Recorded {row.at}</p></li>)}</ul>}</details>
      </>}
    </form>}
  </section>;
}
