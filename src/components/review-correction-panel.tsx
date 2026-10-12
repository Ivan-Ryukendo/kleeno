"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { formatUsdc } from "@/core/money";
import type { loadReviewCorrections } from "@/server/db/review-corrections";
import { postJson } from "@/lib/api";

type View = Awaited<ReturnType<typeof loadReviewCorrections>>;
const actionClass = "min-h-11 max-w-full rounded-field px-4 text-sm whitespace-normal";
function Delta({ delta }: { delta: NonNullable<View["preview"]>["delta"] }) {
  return <div className="mt-3 min-w-0 text-sm"><dl className="grid gap-3 sm:grid-cols-3">{(["gross", "deductions", "net"] as const).map(key => <div key={key} className="rounded-field border border-border p-3"><dt className="capitalize">{key} difference</dt><dd className="mt-1 break-all tabular-nums">{formatUsdc(BigInt(delta.totals[key]))} USDC</dd></div>)}</dl><details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center rounded-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Worker differences</summary><ul className="divide-y divide-border">{delta.workers.map(worker => <li key={worker.workerId} className="py-3"><p className="break-all font-mono">{worker.workerId}</p><p className="mt-1">{worker.change.toLowerCase()} · net difference <span className="tabular-nums">{formatUsdc(BigInt(worker.delta.net))} USDC</span></p><p className="mt-1 text-muted-foreground tabular-nums">Gross {formatUsdc(BigInt(worker.delta.gross))} · deductions {formatUsdc(BigInt(worker.delta.deductions))} USDC</p></li>)}</ul></details></div>;
}
export function ReviewCorrectionPanel({ runId, onDenied }: { runId: string; onDenied?: (message: string) => void }) {
  const [view, setView] = useState<View | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState(""), [reason, setReason] = useState(""), [source, setSource] = useState("");
  const alert = useRef<HTMLParagraphElement>(null), retry = useRef<{ payload: string; key: string } | null>(null), generation = useRef(0);
  const endpoint = `/api/runs/${encodeURIComponent(runId)}/corrections`;
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  async function load(signal?: AbortSignal, selected = replacementId) {
    const request = ++generation.current; setLoading(true); setError(null);
    try {
      const response = await fetch(`${endpoint}${selected ? `?replacement=${encodeURIComponent(selected)}` : ""}`, { cache: "no-store", signal });
      if (signal?.aborted || request !== generation.current) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) { setView(null); setReason(""); setSource(""); retry.current = null; onDenied?.("Review access changed. Reload this run to check current access."); }
        throw new Error(response.status === 409 ? "Replacement evidence changed. Select another run or reload the review." : "Correction evidence could not be loaded. Reload to try again.");
      }
      const data = await response.json();
      if (!signal?.aborted && request === generation.current) setView(data);
    } catch (e) { if (!signal?.aborted && request === generation.current) { setView(null); setError(e instanceof Error ? e.message : "Correction evidence unavailable."); } }
    finally { if (!signal?.aborted && request === generation.current) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort();
    // The keyed run panel remounts when company/run changes; selected target reloads its exact preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, replacementId]);
  async function save() {
    const current = view?.current, replacement = view?.candidates.find(candidate => candidate.id === replacementId);
    if (busy || loading || !current || !replacement || !view?.canLink || view.preview?.replacementRunId !== replacementId) return;
    const content = { replacementRunId: replacementId, originalCalculationId: current.calculationId, originalCalculationHash: current.calculationHash, replacementCalculationId: replacement.calculationId, replacementCalculationHash: replacement.calculationHash, originalReviewRevision: current.reviewRevision, replacementReviewRevision: 0, reason: reason.trim(), source: source.trim() };
    const payload = JSON.stringify(content); if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    setBusy(true); setError(null); setNotice(null);
    const result = await postJson(endpoint, { ...content, idempotencyKey: retry.current.key });
    setBusy(false);
    if (!result.ok) { if ([401, 403].includes(result.status ?? 0)) { setView(null); setReason(""); setSource(""); retry.current = null; onDenied?.("Review access changed. Reload this run to check current access."); } setError(result.error ?? "Correction could not be linked. Reload current evidence before trying again."); return; }
    retry.current = null; setReplacementId(""); setReason(""); setSource(""); setNotice("Replacement linked. Open it and complete a fresh human review and export."); await load(undefined, "");
  }
  return <section className="mt-6 panel min-w-0" aria-labelledby="correction-heading" aria-busy={busy || loading}>
    <h2 id="correction-heading" className="text-lg">Linked replacement review</h2>
    <p className="mt-2 text-sm text-muted-foreground">Preserve the signed original and link a separately calculated simulation for review and handoff. This does not instruct anyone to re-pay wages or recover an overpayment.</p>
    {loading && <p role="status" className="mt-3 text-sm">Loading correction evidence…</p>}
    {error && <p role="alert" tabIndex={-1} ref={alert} className="mt-3 break-words text-sm text-signal">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    <Button type="button" className={`${actionClass} mt-3`} disabled={busy || loading} style={{ transition: "none", transform: "none" }} onClick={() => { setReplacementId(""); void load(undefined, ""); }}>Reload correction evidence</Button>
    {view && !loading && <>
      {view.links.map(link => <article key={link.id} className="mt-4 min-w-0 rounded-box border border-border p-3 text-sm"><p className="font-medium">Recorded replacement link · <time dateTime={link.at}>{link.at}</time></p><div className="mt-2 flex flex-wrap gap-3"><a className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/runs/${link.originalRunId}`}>Open signed original</a><a className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/runs/${link.replacementRunId}`}>Open replacement review</a></div><p className="mt-2 whitespace-pre-wrap break-words">Reason: {link.reason}</p><p className="mt-2 whitespace-pre-wrap break-words">Source: {link.source}</p><p className="mt-2 break-all font-mono text-xs">Original: {link.originalCalculationHash}<br />Replacement: {link.replacementCalculationHash}</p><Delta delta={link.delta} /></article>)}
      {!view.links.length && <p className="mt-3 text-sm text-muted-foreground">No replacement link recorded.</p>}
      {!view.canLink && <p className="mt-3 text-sm text-muted-foreground">A signed original and current HR/payroll reviewer access are required. A signed original can have one replacement; later corrections begin from the freshly signed replacement.</p>}
      {view.canLink && <form className="mt-4 max-w-xl space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}><div><Label htmlFor="correction-target">Replacement simulation</Label><Select id="correction-target" value={replacementId} required disabled={busy} onChange={e => { setReplacementId(e.target.value); setNotice(null); }}><option value="">Choose a separately calculated run</option>{view.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.periodStart} to {candidate.periodEnd} · {candidate.id}</option>)}</Select></div>{!view.candidates.length && <p className="text-sm text-muted-foreground">No unsigned validated simulation with a different calculation is available for this exact period. Create and calculate a separate simulation through the existing workflow first.</p>}{view.candidatesLimited && <p className="text-sm text-muted-foreground">Showing eligible runs among the 50 most recent simulations of this period.</p>}{view.preview && <><p className="break-all text-xs font-mono">Replacement calculation: {view.candidates.find(candidate => candidate.id === replacementId)?.calculationHash}</p><Delta delta={view.preview.delta} /></>}<div><Label htmlFor="correction-reason">Correction reason</Label><textarea id="correction-reason" value={reason} required maxLength={2000} disabled={busy} onChange={e => setReason(e.target.value)} className="w-full min-h-24 min-w-0 rounded-field border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div><div><Label htmlFor="correction-source">Source reference</Label><Input id="correction-source" value={source} required maxLength={500} disabled={busy} onChange={e => setSource(e.target.value)} aria-describedby="correction-source-hint" /><p id="correction-source-hint" className="mt-1 text-xs text-muted-foreground">Use a review ticket or evidence reference; no worker names or credentials. This reference is stored privately and is never fetched.</p></div><p className="text-sm text-muted-foreground">Linking preserves both calculations. It does not sign off the replacement or authorize payment.</p><Button type="submit" disabled={busy || !replacementId || !reason.trim() || !source.trim() || view.preview?.replacementRunId !== replacementId} className={actionClass} style={{ transition: "none", transform: "none" }}>{busy ? "Linking replacement…" : "Link this replacement"}</Button></form>}
    </>}
  </section>;
}
