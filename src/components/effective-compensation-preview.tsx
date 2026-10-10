"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { CalendarDateSchema } from "@/core/workers";
import { CompensationPreviewSchema, type CompensationPreview } from "@/core/workers/effective-compensation";
import { formatUsdc } from "@/core/money";
import { postJson } from "@/lib/api";

const integer = z.string().regex(/^-?\d{1,30}$/);
const totals = z.object({ gross: integer, deductions: integer, net: integer }).strict();
const trace = z.object({ component: z.string(), source: z.string(), rule: z.string(), ruleVersion: z.number().int().positive(), inputs: z.record(z.string(), z.string()), step: z.number().int().nonnegative(), amount: integer }).strict();
const PreviewSchema = z.object({ authority: z.literal("PREVIEW_ONLY"), runId: z.string().uuid(), workerId: z.string().uuid(), period: z.object({ start: CalendarDateSchema, end: CalendarDateSchema }).strict(), configVersion: z.number().int().positive(), timelineRevision: z.number().int().nonnegative(), adjustmentRevision: z.number().int().nonnegative(), evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), proposal: z.object({ sourceId: z.string().uuid(), sourceVersion: z.number().int().positive(), kind: z.literal("PROPOSAL_ONLY"), recorded: z.literal(false) }).strict(), before: totals.extend({ trace: z.array(trace) }), after: totals.extend({ trace: z.array(trace) }), delta: totals }).strict();
export function validatedPayPreview(raw: unknown, workerId: string, command: CompensationPreview) {
  const result = PreviewSchema.parse(raw);
  if (result.workerId !== workerId || result.runId !== command.runId || result.timelineRevision !== command.expectedRevision || result.proposal.sourceVersion !== command.expectedRevision + 1 || result.period.end < result.period.start) throw new Error("Preview evidence changed. Review the current schedule again.");
  for (const side of [result.before, result.after]) if (BigInt(side.gross) - BigInt(side.deductions) !== BigInt(side.net)) throw new Error("Preview totals could not be verified.");
  for (const field of ["gross", "deductions", "net"] as const) if (BigInt(result.after[field]) - BigInt(result.before[field]) !== BigInt(result.delta[field])) throw new Error("Preview differences could not be verified.");
  return result;
}
type Period = { id: string; status: string; period_start: string; period_end: string };
export function EffectivePayPreview({ workerId, periods, proposal, onDenied }: { workerId: string; periods: Period[]; proposal: Omit<CompensationPreview, "runId"> | null; onDenied?: (message: string) => void }) {
  const ready = periods.filter(period => period.status === "READY_FOR_CALCULATION");
  const [runId, setRunId] = useState(""), [busy, setBusy] = useState(false), [result, setResult] = useState<z.infer<typeof PreviewSchema> | null>(null), [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null), sequence = useRef(0);
  const report = (message: string) => { setError(message); };
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function preview() {
    setResult(null); setError(null);
    const selected = ready.find(period => period.id === runId);
    if (!proposal || !selected) { report("Review the date and rate fields, then choose a ready period."); return; }
    let command: CompensationPreview;
    try { command = CompensationPreviewSchema.parse({ ...proposal, runId }); } catch { report("Check the proposed rates and review the current date before previewing."); return; }
    const seq = ++sequence.current; setBusy(true);
    const response = await postJson(`/api/workers/${workerId}/effective-compensation/preview`, command);
    if (seq !== sequence.current) return;
    try {
      if (!response.ok && [401, 403, 404].includes(response.status ?? 0) && onDenied) { onDenied(response.error ?? "Current worker access changed. Reload before reviewing pay."); return; }
      if (!response.ok) throw new Error(response.error ?? "Pay preview is unavailable. Review current evidence and try again.");
      const verified = validatedPayPreview(response.data, workerId, command);
      if (verified.period.start !== selected.period_start || verified.period.end !== selected.period_end) throw new Error("The selected period changed. Reload its evidence before previewing.");
      setResult(verified);
    } catch (caught) { report(caught instanceof z.ZodError ? "Pay preview evidence is incomplete. Review current evidence and try again." : caught instanceof Error ? caught.message : "Pay preview is unavailable."); }
    finally { setBusy(false); }
  }
  const money = (value: string) => formatUsdc(BigInt(value));
  return <section aria-labelledby={`pay-preview-${workerId}`} className="space-y-3 border-t border-border pt-4">
    <h4 id={`pay-preview-${workerId}`} className="text-sm font-medium">Before and after pay</h4>
    <p className="text-sm text-muted-foreground">Preview this proposed rate using a ready period’s actual reconciled inputs. It saves no calculation, approves nothing and cannot pay. Unresolved or undated split inputs remain blockers.</p>
    {ready.length === 0 ? <p className="text-sm">No ready, uncalculated company period is available in this impact review.</p> : <>
      <Label htmlFor={`pay-preview-period-${workerId}`}>Ready company period</Label><Select id={`pay-preview-period-${workerId}`} value={runId} disabled={busy} onChange={event => { sequence.current++; setRunId(event.target.value); setResult(null); setError(null); }}><option value="">Choose a period</option>{ready.map(period => <option key={period.id} value={period.id}>{period.period_start} – {period.period_end} · {period.id.slice(0, 8)}</option>)}</Select>
      <Button type="button" variant="outline" disabled={busy || !proposal || !runId} className="min-h-11" onClick={preview}>{busy ? "Checking pay…" : "Preview pay difference"}</Button>
      {!proposal && <p className="text-sm">Review the effective date and complete the rate fields before previewing.</p>}
    </>}
    {error && <p ref={alertRef} role="alert" tabIndex={-1} className="rounded-field border border-signal p-3 text-sm text-signal focus-visible:outline-2 focus-visible:outline-primary">{error}</p>}
    {result && <div className="space-y-3 rounded-field border border-border p-3">
      <p role="status" className="text-sm">Preview only · {result.period.start} – {result.period.end} · Policy v{result.configVersion} · Schedule revision {result.timelineRevision}</p>
      <dl className="space-y-3 text-sm">{(["gross", "deductions", "net"] as const).map(field => <div key={field}><dt className="font-medium capitalize">{field}</dt><dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums"><span>Before {money(result.before[field])}</span><span>After {money(result.after[field])}</span><span>Change {BigInt(result.delta[field]) > 0n ? "+" : ""}{money(result.delta[field])} USDC</span></dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Proposed compensation source is unrecorded. Saving a schedule does not capture or approve this preview. Recalculate through the normal run workflow.</p>
      <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Calculation evidence</summary><p className="break-all text-xs">Evidence fingerprint: {result.evidenceFingerprint}</p>{(["before", "after"] as const).map(side => <div className="mt-3" key={side}><h5 className="text-sm font-medium capitalize">{side}</h5><ol className="mt-2 space-y-2 text-xs">{result[side].trace.map((line, index) => <li className="break-words" key={index}><p>{line.component} · {money(line.amount)} USDC · {line.rule} v{line.ruleVersion}</p><p>Source: {line.source}</p><dl>{Object.entries(line.inputs).map(([key, value]) => <div key={key}><dt className="inline">{key}: </dt><dd className="inline">{value}</dd></div>)}</dl></li>)}</ol></div>)}</details>
    </div>}
  </section>;
}
