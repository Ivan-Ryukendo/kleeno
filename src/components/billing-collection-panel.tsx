"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { BillingCollection } from "@/core/billing-collection";
import { postJson } from "@/lib/api";
export interface CollectionSummary { id: string; action: string; idempotencyKey: string; stage: number; status: string; month: string | null; sourceHash: string | null; amountCents: number | null; uniqueWorkers: number; invoiceId: string | null; invoiceStatus: string | null; checkoutId: string | null; usageReconciliation: string }
type Quote = { month: string; amountCents: number; uniqueWorkers: number; sourceHash: string };
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function BillingCollectionPanel({ configured, linked, billable, baseCents, history = [] }: { configured: boolean; linked: boolean; billable: boolean; baseCents: number | null; history?: CollectionSummary[] }) {
  const router = useRouter(), [action, setAction] = useState<"checkout" | "cancel" | "usage">("checkout"), [month, setMonth] = useState(""), [quote, setQuote] = useState<Quote | null>(null), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null), [checkoutUrl, setCheckoutUrl] = useState<string | null>(null), [recoveryId, setRecoveryId] = useState(""), [objectId, setObjectId] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const report = (message: string) => { setError(message); };
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const deny = () => { setDenied(true); setQuote(null); setPassword(""); setCheckoutUrl(null); setNote(null); setRecoveryId(""); setObjectId(""); retry.current = null; };
  const available = configured && billable && !denied;
  async function preview() {
    setBusy(true); setError(null); setQuote(null);
    try {
      const response = await fetch(`/api/billing/usage?${new URLSearchParams({ month: month + "-01" })}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) { if ([401, 403].includes(response.status)) deny(); throw new Error(json?.error?.message ?? "Usage quote unavailable"); }
      if (json.month !== month + "-01" || !Number.isSafeInteger(json.amountCents) || json.amountCents < 0 || json.amountCents > 100_000_000 || !Number.isSafeInteger(json.uniqueWorkers) || json.uniqueWorkers < 0 || json.uniqueWorkers > 10000 || !/^[a-f0-9]{64}$/.test(json.sourceHash)) throw new Error("Usage quote is incomplete; reload before invoicing");
      setQuote(json);
    } catch (caught) { report(caught instanceof Error ? caught.message : "Usage quote unavailable"); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>, resume?: CollectionSummary) {
    event.preventDefault(); setError(null); setNote(null); setCheckoutUrl(null);
    let command: BillingCollection;
    const currentAction = resume?.action ?? action;
    if (currentAction === "checkout") {
      const expectedBaseCents = resume?.amountCents ?? baseCents;
      if (expectedBaseCents === null) { report("Review the current company base price before Checkout."); return; }
      command = { action: "checkout", expectedBaseCents, idempotencyKey: "" };
    } else if (currentAction === "cancel") command = { action: "cancel", idempotencyKey: "" };
    else {
      if (!resume && (!quote || quote.month !== month + "-01")) { report("Review a closed UTC month before creating its usage invoice."); return; }
      const selected = resume ? { month: resume.month!, amountCents: resume.amountCents!, sourceHash: resume.sourceHash! } : quote!;
      if (!selected.sourceHash) { report("Frozen usage quote is unavailable."); return; }
      command = { action: "usage", month: selected.month, expectedAmountCents: selected.amountCents, expectedSourceHash: selected.sourceHash, idempotencyKey: "" };
    }
    const fingerprint = JSON.stringify(command);
    const key = resume?.idempotencyKey ?? (retry.current?.fingerprint === fingerprint ? retry.current.key : crypto.randomUUID());
    retry.current = { fingerprint, key }; command.idempotencyKey = key;
    setBusy(true);
    const result = await postJson<{ checkoutUrl?: string | null }>("/api/billing/collect", { command, password });
    setPassword("");
    if (result.ok) { setNote("TEST provider request observed. This does not prove payment collection or grant software/payroll entitlements."); setCheckoutUrl(result.data?.checkoutUrl ?? null); retry.current = null; setQuote(null); router.refresh(); }
    else { if ([401, 403].includes(result.status ?? 0)) deny(); if (result.status === 409) { setQuote(null); router.refresh(); } report(result.error ?? "Billing request failed. Keep the same command and reconcile uncertain outcomes before retrying."); }
    setBusy(false);
  }
  const ready = history.filter(command => command.status === "READY"), uncertain = history.filter(command => ["UNKNOWN", "IN_FLIGHT"].includes(command.status));
  return <section className="mt-6 panel" aria-labelledby="billing-collection-heading"><h2 id="billing-collection-heading" className="text-lg">Owner-confirmed Stripe TEST actions</h2>
    <p className="mt-3 text-sm text-muted-foreground">Base fees are billed at subscription start and each signup-anniversary month. Reviewed-worker usage is invoiced separately after a UTC calendar month closes. No prorated plan changes. Cancellation takes effect at period end. Taxes, refunds, retention and software entitlements remain unconfigured; no live collection.</p>
    {error && <p role="alert" tabIndex={-1} ref={errorRef} className="mt-4 rounded-field border border-signal p-3 text-sm text-signal focus-visible:outline-2 focus-visible:outline-primary">{error}</p>}{note && <p role="status" className="mt-4 text-sm">{note}</p>}
    {available && checkoutUrl && <a className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4" href={checkoutUrl} rel="noreferrer" target="_blank">Open Stripe TEST Checkout</a>}
    {!available ? <p className="mt-4 text-sm">{denied ? "Current Owner access changed. Reload after checking your membership." : "An explicit billable assignment and Stripe TEST setup are required before provider actions."}</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
      <div><Label htmlFor="billing-action">Action</Label><Select id="billing-action" disabled={busy} value={action} onChange={event => { setAction(event.target.value as typeof action); setNote(null); }}><option value="checkout" disabled={history.some(command => command.action === "checkout")}>Create TEST Checkout</option><option value="cancel" disabled={!linked}>Cancel at period end</option><option value="usage" disabled={!linked}>Invoice a closed UTC month</option></Select></div>
      {action === "checkout" && <p className="text-sm">Reviewed monthly base: {baseCents === null ? "Unassigned" : dollars(baseCents)}. Worker usage is excluded from this Checkout.</p>}
      {action === "cancel" && <p className="text-sm">Request cancellation of the server-bound subscription at its current period end. Existing records are retained; this grants no payroll/payment authority.</p>}
      {action === "usage" && <><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="sm:flex-1"><Label htmlFor="billing-usage-month">Closed month (UTC)</Label><Input id="billing-usage-month" type="month" value={month} disabled={busy} required onChange={event => { setMonth(event.target.value); setQuote(null); }} /></div><Button type="button" variant="outline" className="min-h-11" disabled={busy || !month} onClick={preview}>Review usage quote</Button></div>{quote ? <p className="text-sm">{quote.month.slice(0, 7)} UTC · {quote.uniqueWorkers} unique reviewed workers · {dollars(quote.amountCents)}. Prices come from each worker&apos;s original usage assignment. A changed source blocks invoicing until reviewed again.</p> : <p className="text-sm text-muted-foreground">No current quote. The server will not accept an unreviewed month or caller-supplied charge amount.</p>}</>}
      <div><Label htmlFor="billing-password">Confirm with your password</Label><Input id="billing-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /></div>
      <Button className="min-h-11" type="submit" disabled={busy || !password || (action === "checkout" && (baseCents === null || history.some(command => command.action === "checkout"))) || (action !== "checkout" && !linked) || (action === "usage" && !quote)}>{busy ? "Working…" : action === "checkout" ? "Create reviewed TEST Checkout" : action === "cancel" ? "Confirm period-end cancellation" : "Create reviewed TEST usage invoice"}</Button>
    </form>}
    {available && ready.length > 0 && <section className="mt-5 border-t border-border pt-4"><h3 className="text-base">Prepared commands</h3><p className="mt-2 text-sm text-muted-foreground">Continue the same frozen command after an observed stage. Enter your password above; no new charge key is created.</p>{ready.map(command => <form key={command.id} onSubmit={event => submit(event, command)} className="mt-3"><Button variant="outline" type="submit" className="min-h-11" disabled={busy || !password || command.usageReconciliation !== "MATCHED"}>Continue {command.action} {command.month?.slice(0, 7)} · stage {command.stage}</Button></form>)}</section>}
    {available && uncertain.length > 0 && <form className="mt-5 space-y-3 border-t border-border pt-4" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(null); const result = await postJson("/api/billing/commands/reconcile", { commandId: recoveryId, objectId }); if (result.ok) { setNote("Current provider evidence reconciled. Any remaining write requires a separate password-confirmed continuation."); router.refresh(); } else { if ([401, 403].includes(result.status ?? 0)) deny(); report(result.error ?? "Provider evidence could not be reconciled; do not create a replacement charge."); } setBusy(false); }}><h3 className="text-base">Reconcile an uncertain request</h3><p className="text-sm text-muted-foreground">No automatic retry. Supply the exact TEST object from the provider dashboard; Kleeno fetches and verifies its intent, customer, subscription and amount. This action sends no provider mutation.</p><div><Label htmlFor="billing-recovery-command">Uncertain command</Label><Select id="billing-recovery-command" value={recoveryId} required disabled={busy} onChange={event => setRecoveryId(event.target.value)}><option value="">Choose a command</option>{uncertain.map(command => <option key={command.id} value={command.id}>{command.action} {command.month?.slice(0, 7)} · stage {command.stage} · {command.id}</option>)}</Select></div><div><Label htmlFor="billing-recovery-object">Exact provider object ID</Label><Input id="billing-recovery-object" value={objectId} maxLength={255} required disabled={busy} onChange={event => setObjectId(event.target.value)} /></div><Button type="submit" variant="outline" className="min-h-11" disabled={busy || !recoveryId || !objectId}>Read and reconcile provider evidence</Button></form>}
    {!denied && <details className="mt-5 border-t border-border pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">Recorded TEST command history ({history.length})</summary><p className="mt-2 text-sm text-muted-foreground">DONE means the request was observed, not that wages or an invoice were paid. Invoice status is the latest recorded observation and may be stale.</p>{history.length === 0 ? <p className="mt-3 text-sm">No TEST collection commands recorded.</p> : <ul className="mt-3 space-y-3 text-sm">{history.map(command => <li key={command.id} className="break-words"><p>{command.action} {command.month?.slice(0, 7)} · {command.status === "DONE" ? "Request observed" : command.status.replaceAll("_", " ")} · {command.amountCents !== null ? dollars(command.amountCents) : "Period-end cancellation"}</p>{command.invoiceId && <p className="text-muted-foreground">Invoice: {command.invoiceId} · {command.invoiceStatus ?? "Unobserved"}</p>}{command.usageReconciliation !== "MATCHED" && <p className="text-signal">Unreconciled late usage. The frozen invoice no longer covers all current month evidence; no replacement charge is authorized.</p>}<p className="text-xs text-muted-foreground">Command {command.id}</p></li>)}</ul>}</details>}
  </section>;
}
