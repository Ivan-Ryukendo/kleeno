"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { formatUsdc } from "@/core/money";
import type { ReviewView } from "@/core/workflow/review";
import type { reviewerWorkspace } from "@/server/db/reviewer-workspace";
import { postJson } from "@/lib/api";
import { HistoricalThresholdPanel } from "@/components/historical-threshold-panel";
import { EvidencePackDownload } from "@/components/evidence-pack-download";
import { ReviewCorrectionPanel } from "@/components/review-correction-panel";
import { LocalTime } from "@/components/local-time";
import { zoneDisplaySafe } from "@/lib/timezone-display";

type Workspace = Awaited<ReturnType<typeof reviewerWorkspace>>;
type Download = { filename: string; csv: string; byteHash: string };
const actionClass = "min-h-11 max-w-full rounded-field px-4 text-sm whitespace-normal";
const decisionStyle = { transition: "none", transform: "none" };
const outcomeLabel = { MANUAL_ACCEPTED: "Accepted manually — not payment settlement", MANUAL_REJECTED: "Rejected — handoff remains open", UNKNOWN: "Unknown — handoff remains open" };
type ComparedComponent = NonNullable<Workspace["comparison"]>["workers"][number]["components"][number];

function ComponentSources({ component }: { component: ComparedComponent }) {
  return <details className="mt-3 rounded-box border border-border p-3 text-sm">
    <summary className="flex min-h-11 cursor-pointer items-center rounded-field font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sources and rules for {component.component.replaceAll("_", " ")}</summary>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">{(["Previous", "Current"] as const).map(label => {
      const traces = (label === "Previous" ? component.previousTrace : component.currentTrace) ?? [];
      return <div key={label} className="min-w-0"><h4 className="font-medium">{label} component evidence</h4>{traces.length === 0 ? <p className="mt-2 text-muted-foreground">No recorded component in this run.</p> : <ul className="mt-2 space-y-3">{traces.map(trace => <li key={trace.step} className="min-w-0"><p className="break-words">{trace.rule} v{trace.ruleVersion} · <span className="tabular-nums">{trace.amount} USDC</span></p><p className="mt-1 break-words text-muted-foreground">Source: {trace.source}</p><dl className="mt-1 space-y-1 text-xs">{Object.entries(trace.inputs).map(([key, value]) => <div key={key} className="flex flex-wrap gap-x-2"><dt className="break-words text-muted-foreground">{key}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl></li>)}</ul>}</div>;
    })}</div>
  </details>;
}

/** Readiness, comparison and commercial review remain separate from payroll/payment authority. */
export function PayrollReviewPanel({ runId, data, timeZone = "UTC" }: { runId: string; data: Workspace; /** viewer display zone, resolved on the server */ timeZone?: string }) {
  const router = useRouter();
  const [review, setReview] = useState(data.review);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const canAct = data.canReview && !!review.calculationId && !!review.calculationHash;

  async function command(action: "signoff" | "export" | "acknowledge", extra: Record<string, string> = {}) {
    if (busy || !canAct) return;
    setBusy(action); setError(null); setNotice(null);
    try {
    const body = { action, expectedRevision: review.revision, calculationId: review.calculationId, calculationHash: review.calculationHash, ...extra };
    const payload = JSON.stringify(body);
    if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    const result = await postJson<{ view: ReviewView; download?: Download }>(`/api/runs/${runId}/review`, { ...body, idempotencyKey: retry.current.key });
    if (!result.ok || !result.data?.view) { if ([401, 403].includes(result.status ?? 0)) setDenied(true); setError(result.error ?? "The review could not be saved. Reload and try again."); }
    else {
      setReview(result.data.view); retry.current = null;
      if (result.data.download) {
        const file = result.data.download;
        const bytes = new TextEncoder().encode(file.csv);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2, "0")).join("");
        if (digest !== file.byteHash || digest !== result.data.view.export?.byteHash) setError("The CSV does not match its recorded manifest. Nothing was downloaded.");
        else {
          const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv;charset=utf-8" }));
          const link = document.createElement("a"); link.href = url; link.download = file.filename; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setNotice("Reviewed CSV downloaded. Record the recipient's outcome separately.");
        }
      } else setNotice(action === "signoff" ? "Review sign-off recorded. Nothing is paid by this." : "Manual outcome recorded. This is not proof of payment settlement.");
      router.refresh();
    }
    } catch {
      setError("The saved review or CSV could not be processed. Reload to check the recorded outcome before retrying.");
    } finally { setBusy(null); }
  }

  if (denied) return <section className="mt-6 panel"><h2 className="text-lg">Review access changed</h2><p role="alert" tabIndex={-1} ref={errorRef} className="mt-3 text-sm">{error ?? "Reload this run to check your current access."}</p><a href={`/runs/${runId}`} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Reload current access</a></section>;
  return <div className="min-w-0">
    <section className="mt-6 panel min-w-0" aria-labelledby="readiness-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-heading" className="text-lg">Review readiness</h2>
        <p className={data.readiness.ready ? "text-sm font-medium" : "text-sm font-medium text-signal"}>{data.readiness.ready ? "Ready for review" : "Review blocked"}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{data.settings ? `${data.readiness.received} of ${data.readiness.expected} required inputs received.` : "Data required: configure expected inputs and a company cutoff."}</p>
      {data.readiness.cutoff && <p className="mt-2 break-words text-sm">Cutoff: <LocalTime at={data.readiness.cutoff.at} timeZone={timeZone} /> · set for {zoneDisplaySafe(data.readiness.cutoff.timeZone, data.readiness.cutoff.at)}</p>}
      {data.readiness.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-signal">{data.readiness.blockers.map((blocker, i) => <li key={`${i}-${blocker}`}>{blocker}</li>)}</ul>}
      {data.readiness.items.length > 0 && <dl className="mt-4 divide-y divide-border text-sm">{data.readiness.items.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"><dt className="font-medium">{item.label}</dt><dd className="min-w-0 text-right"><p>{item.status === "MISSING" ? "Data required" : item.status.toLowerCase().replaceAll("_", " ")}</p>{item.reason && <p className="mt-1 break-words text-muted-foreground">{item.reason}</p>}{item.ref && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Evidence: {item.ref}</p>}</dd></div>)}</dl>}
      {data.canConfigure && !review.signoff && <details className="mt-4 border-t border-border pt-3" open={!data.settings}>
        <summary className="flex min-h-11 cursor-pointer items-center rounded-field font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Configure readiness settings</summary>
        <form className="mt-3 max-w-xl space-y-4" aria-busy={busy === "settings"} onSubmit={async e => {
          e.preventDefault(); if (busy) return;
          const f = new FormData(e.currentTarget), requiredTypes = f.getAll("requiredTypes");
          if (!requiredTypes.length) { setError("Choose at least one required input type."); return; }
          setBusy("settings"); setError(null); setNotice(null);
          const result = await postJson(`/api/runs/${runId}/readiness`, { expectedRevision: data.settings?.revision ?? 0, cutoffAt: f.get("cutoffAt"), timeZone: f.get("timeZone"), requiredTypes, freshAfter: f.get("freshAfter") || null });
          if (!result.ok) { if ([401, 403].includes(result.status ?? 0)) setDenied(true); setError(result.error ?? "Readiness settings were not saved."); }
          else { setNotice("Readiness settings saved."); router.refresh(); }
          setBusy(null);
        }}>
          <div><Label htmlFor="review-cutoff">Cutoff (date/time with UTC offset)</Label><Input id="review-cutoff" name="cutoffAt" defaultValue={data.settings?.cutoffAt ?? ""} required aria-describedby="cutoff-hint" /><p id="cutoff-hint" className="mt-1 text-xs text-muted-foreground">Use YYYY-MM-DDTHH:mm:ss+HH:mm or a trailing Z. Include the intended UTC offset; no timezone is inferred.</p></div>
          <div><Label htmlFor="review-timezone">Company timezone</Label><Input id="review-timezone" name="timeZone" defaultValue={data.settings?.timeZone ?? ""} required aria-describedby="timezone-hint" /><p id="timezone-hint" className="mt-1 text-xs text-muted-foreground">Use a timezone name, for example Asia/Dhaka or America/New_York.</p></div>
          <fieldset><legend className="mb-2 text-sm font-medium">Required inputs</legend><p className="mb-2 text-xs text-muted-foreground">Select only the evidence this company requires. Every selected type blocks review until received.</p>{(["TIMESHEETS", "LEAVE", "ACTUAL_PAID"] as const).map(type => <label key={type} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" name="requiredTypes" value={type} defaultChecked={data.settings?.requiredTypes.includes(type) ?? false} className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />{type === "TIMESHEETS" ? "Timesheets" : type === "LEAVE" ? "Leave records" : "Actually paid amounts"}</label>)}</fieldset>
          <div><Label htmlFor="review-freshness">Evidence freshness boundary (optional)</Label><Input id="review-freshness" name="freshAfter" defaultValue={data.settings?.freshAfter ?? ""} aria-describedby="freshness-hint" /><p id="freshness-hint" className="mt-1 text-xs text-muted-foreground">Same date/time format with UTC offset. Leave empty when no freshness boundary is required.</p></div>
          <Button type="submit" disabled={!!busy} className={actionClass} style={decisionStyle}>{busy === "settings" ? "Saving settings…" : "Save readiness settings"}</Button>
        </form>
      </details>}
      {!data.canConfigure && !data.settings && <p className="mt-3 text-sm text-muted-foreground">A payroll reviewer must configure the required inputs and cutoff.</p>}
    </section>

    <section className="mt-6 panel min-w-0" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading" className="text-lg">What changed</h2>
      <p className="mt-2 text-sm text-muted-foreground">Compare exact calculated amounts with a selected prior validated run. A missing baseline is unavailable, never zero.</p>
      <div className="mt-4 max-w-xl"><Label htmlFor="review-baseline">Comparison baseline</Label><Select id="review-baseline" value={data.selectedBaselineId ?? ""} disabled={!!busy || !data.baselines.length} onChange={e => { const url = new URL(window.location.href); if (e.target.value) url.searchParams.set("baseline", e.target.value); else url.searchParams.delete("baseline"); router.push(`${url.pathname}${url.search}${url.hash}`); }}><option value="">Select a prior run</option>{data.baselines.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.label}</option>)}</Select></div>
      {!data.baselines.length && <p className="mt-3 text-sm text-muted-foreground">No prior validated run is available.</p>}
      {(!data.comparison || data.comparison.status !== "COMPARED") ? <p className="mt-4 text-sm text-muted-foreground">{data.comparison?.reason ?? "Calculate and validate this run, then select a comparable baseline."}</p> : <>
        {data.comparison.baseline && <p className="mt-3 break-words text-sm">Baseline: {data.comparison.baseline.period.start} to {data.comparison.baseline.period.end} · config v{data.comparison.baseline.configVersion}</p>}
        {data.comparison.baseline && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Baseline calculation: {data.comparison.baseline.calculationHash}</p>}
        {data.comparison.totals && <div className="mt-4 grid gap-3 sm:grid-cols-3">{(["gross", "deductions", "net"] as const).map(component => <dl key={component} className="rounded-box border border-border p-3 text-sm"><dt className="font-medium capitalize">{component} (USDC)</dt><dd className="mt-2 tabular-nums">Previous: {data.comparison!.totals![component].previous}</dd><dd className="tabular-nums">Current: {data.comparison!.totals![component].current}</dd><dd className="mt-1 font-medium tabular-nums">Difference: {data.comparison!.totals![component].delta}</dd></dl>)}</div>}
        <div className="mt-4 divide-y divide-border">{data.comparison.workers.map(worker => <details key={worker.workerId} className="min-w-0 py-2"><summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 rounded-field text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-medium">{worker.worker}</span><span>{worker.change} · net difference <span className="tabular-nums">{worker.net.delta} USDC</span></span></summary><p className="mt-2 text-sm tabular-nums">Net: {worker.net.previous} → {worker.net.current} USDC</p><div role="region" aria-label={`Component changes for ${worker.worker}`} tabIndex={0} className="mt-3 max-w-full overflow-x-auto rounded-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><table className="w-full min-w-[30rem] text-left text-sm"><caption className="sr-only">Exact component changes for {worker.worker}, amounts in USDC.</caption><thead className="bg-sidebar text-muted-foreground"><tr><th scope="col" className="p-2 font-medium">Component</th><th scope="col" className="p-2 text-right font-medium">Previous</th><th scope="col" className="p-2 text-right font-medium">Current</th><th scope="col" className="p-2 text-right font-medium">Difference</th></tr></thead><tbody>{worker.components.map(component => <tr key={component.component} className="border-t border-border"><th scope="row" className="p-2 font-normal">{component.component.replaceAll("_", " ")}</th><td className="p-2 text-right tabular-nums">{component.previous}</td><td className="p-2 text-right tabular-nums">{component.current}</td><td className="p-2 text-right tabular-nums">{component.delta}</td></tr>)}</tbody></table></div>{worker.components.map(component => <ComponentSources key={component.component} component={component} />)}<a href={worker.currentTraceId ? `#trace-${worker.currentTraceId}` : "#calculation-trace"} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Inspect the current calculation trace</a></details>)}</div>
      </>}
    </section>

    {data.thresholds && data.findings && <HistoricalThresholdPanel key={`${runId}:${data.thresholds.revision}:${data.thresholds.version ?? "none"}`} runId={runId} settings={{ ...data.thresholds, canConfigure: data.thresholds.canConfigure && !review.signoff }} components={data.thresholdComponents} findings={data.findings} onDenied={message => { setDenied(true); setError(message); }} />}

    <section className="mt-6 panel min-w-0" aria-labelledby="review-heading" aria-busy={!!busy}>
      <h2 id="review-heading" className="text-lg">Review and handoff</h2>
      <p className="mt-2 text-sm text-muted-foreground">Sign-off records the review of this calculation. It never approves payroll, creates obligations or authorizes payment. Downloading a file is separate from delivery and payment settlement.</p>
      {review.signoff ? <p className="mt-4 break-words text-sm font-medium">Review signed off at <time dateTime={review.signoff.at}>{review.signoff.at}</time>. Reviewer account: <span className="break-all font-mono text-xs">{review.signoff.actor}</span>.</p> : <>
        <p id="signoff-reason" className="mt-4 text-sm text-muted-foreground">{!canAct ? "A validated calculation and payroll reviewer access are required." : !data.readiness.ready ? "Resolve the readiness blockers before signing off." : "The sign-off binds this exact calculation and its evidence."}</p>
        <Button type="button" disabled={!!busy || !canAct || !data.readiness.ready} aria-describedby="signoff-reason" className={`${actionClass} mt-3`} style={decisionStyle} onClick={() => void command("signoff")}>{busy === "signoff" ? "Recording sign-off…" : "Sign off this review"}</Button>
      </>}
      {review.calculationHash && <p className="mt-3 break-all text-xs text-muted-foreground">Calculation: <span className="font-mono">{review.calculationHash}</span></p>}
      {review.signoff && data.canReview && (review.export ? <a href={`/api/runs/${runId}/review?download=1`} className="mt-4 inline-flex min-h-11 items-center rounded-field border border-border px-4 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Download existing reviewed CSV</a> : <Button type="button" disabled={!!busy || !data.readiness.ready} className={`${actionClass} mt-4`} style={decisionStyle} onClick={() => void command("export")}>{busy === "export" ? "Preparing CSV…" : "Download reviewed CSV"}</Button>)}
      {review.export && <div className="mt-4 rounded-box border border-border p-3 text-sm"><p>CSV format v{review.export.formatVersion} · exported at {review.export.at}</p><p className="mt-1 tabular-nums">Export net total: {formatUsdc(BigInt(review.export.totals.net))} USDC</p><p className="mt-2 break-all font-mono text-xs text-muted-foreground">File hash: {review.export.byteHash}</p></div>}
      <EvidencePackDownload runId={runId} available={!!review.signoff && !!review.export} disabled={!!busy} onDenied={message => { setDenied(true); setError(message); }} />
      {review.acknowledgement && <div className="mt-4 text-sm"><p className="font-medium">{outcomeLabel[review.acknowledgement.status]}</p><p className="mt-1 break-words">Evidence: {review.acknowledgement.reference}</p><p className="mt-1 text-muted-foreground">Recorded at {review.acknowledgement.at}</p></div>}
      {review.export && data.canReview && <form className="mt-4 max-w-xl space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command("acknowledge", { status: String(f.get("status")), reference: String(f.get("reference")) }); }}>
        <div><Label htmlFor="review-outcome">Manual handoff outcome</Label><Select id="review-outcome" name="status" defaultValue="" required><option value="" disabled>Select the evidenced outcome</option><option value="MANUAL_ACCEPTED">Accepted manually</option><option value="MANUAL_REJECTED">Rejected manually</option><option value="UNKNOWN">Unknown</option></Select></div>
        <div><Label htmlFor="review-evidence">Evidence reference</Label><Input id="review-evidence" name="reference" required maxLength={500} aria-describedby="review-evidence-hint" /><p id="review-evidence-hint" className="mt-1 text-xs text-muted-foreground">Reference the receipt, delivery ticket or reviewer confirmation. Do not paste worker names, salaries or credentials. Manual evidence does not verify settlement.</p></div>
        <Button type="submit" disabled={!!busy} className={actionClass} style={decisionStyle}>{busy === "acknowledge" ? "Recording outcome…" : "Record manual outcome"}</Button>
      </form>}
      {!data.canReview && <p className="mt-4 text-sm text-muted-foreground">You can inspect the recorded review. HR or a payroll reviewer must sign off and record the handoff.</p>}
      {error && <div className="mt-4"><p id="review-error" ref={errorRef} role="alert" tabIndex={-1} className="rounded-field text-sm font-medium text-signal focus:outline-none focus:ring-2 focus:ring-ring">{error}</p><Button type="button" variant="outline" disabled={!!busy} className={`${actionClass} mt-3`} style={decisionStyle} onClick={() => router.refresh()}>Reload review evidence</Button></div>}
      {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    </section>
    <ReviewCorrectionPanel runId={runId} onDenied={message => { setDenied(true); setError(message); }} />
  </div>;
}
