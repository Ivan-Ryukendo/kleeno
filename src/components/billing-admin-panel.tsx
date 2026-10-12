"use client";
import { useRef, useState } from "react";
import type { BillingTier, BillingCommand } from "@/core/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function BillingAdminPanel({ apiBase, initialTiers, initialError }: { apiBase: string; initialTiers: BillingTier[]; initialError: string | null }) {
  const draftId = useRef<string | null>(null), retry = useRef<{ signature: string; key: string } | null>(null);
  const [tiers, setTiers] = useState(initialTiers), [busy, setBusy] = useState(false), [message, setMessage] = useState(initialError);
  const [selected, setSelected] = useState(""), [name, setName] = useState("Review"), [base, setBase] = useState("4900"), [worker, setWorker] = useState("200"), [reason, setReason] = useState("");
  const [companyId, setCompanyId] = useState(""), [revision, setRevision] = useState("0"), [usageEnabled, setUsageEnabled] = useState(false);
  function select(id: string) { setSelected(id); const tier = tiers.find(t => t.id === id); if (tier) { setName(tier.name); setBase(String(tier.baseCents)); setWorker(String(tier.workerCents)); } }
  async function refresh() {
    const response = await fetch(apiBase); const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Catalog could not be loaded");
    setTiers(result.tiers);
  }
  async function send(action: BillingCommand["action"]) {
    setBusy(true); setMessage(null);
    try {
      draftId.current ??= crypto.randomUUID();
      const tier = tiers.find(t => t.id === selected), id = tier?.id ?? draftId.current;
      const common = { id, expectedRevision: action === "assign" || action === "activate_demo" ? Number(revision) : tier?.revision ?? 0, idempotencyKey: crypto.randomUUID(), reason };
      const price = { name, baseCents: Number(base), workerCents: Number(worker) };
      const command = action === "archive" ? { ...common, action } : action === "activate_demo" ? { ...common, action, companyId } : action === "assign" ? { ...common, action, companyId, tierId: tier?.id ?? null, tierRevision: tier?.revision ?? null, price, usageEnabled } : { ...common, action, price };
      const signature = JSON.stringify({ ...command, idempotencyKey: null });
      if (retry.current?.signature === signature) command.idempotencyKey = retry.current.key;
      else retry.current = { signature, key: command.idempotencyKey };
      const response = await fetch(apiBase, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Billing change failed");
      await refresh(); if (action === "assign" || action === "activate_demo") setRevision(String(result.revision));
      retry.current = null; draftId.current = null;
      setReason(""); setMessage("Saved. Existing company prices remain pinned; collection is unavailable.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Billing could not be updated"); }
    finally { setBusy(false); }
  }
  async function loadCompany() {
    setBusy(true); setMessage(null);
    try { const response = await fetch(`${apiBase}?companyId=${encodeURIComponent(companyId)}`); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Company billing unavailable"); setRevision(String(result.revision)); setMessage(`Company revision ${result.revision}. ${result.usage.uniqueWorkers} unique workers in ${result.usage.month} (preview). Demo: ${result.demo.state}${result.demo.expiresAt ? `; expires ${result.demo.expiresAt}` : ""}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Company billing unavailable"); } finally { setBusy(false); }
  }
  return <div className="mt-8 space-y-8">
    <section className="rounded-[2.5rem] border bg-card p-6 sm:p-8" aria-labelledby="catalog-heading">
      <h2 id="catalog-heading" className="text-2xl font-medium">Subscription catalog</h2>
      <p className="mt-2 text-sm text-muted-foreground">Monthly USD prices. Necessary reviewer accounts included. Values below are integer cents: 4900 = $49.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><label htmlFor="billing-tier">Tier to edit</label><select id="billing-tier" value={selected} disabled={busy} onChange={e => select(e.target.value)} className="min-h-11 w-full rounded-[1.25rem] border bg-background px-4"><option value="">New tier / custom enterprise price</option>{tiers.map(t => <option key={t.id} value={t.id}>{t.name} â€” {dollars(t.baseCents)} + {dollars(t.workerCents)}/worker Â· revision {t.revision}{t.archived ? " Â· archived" : ""}</option>)}</select></div>
        <div className="space-y-2"><label htmlFor="billing-name">Tier or enterprise name</label><Input id="billing-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><label htmlFor="billing-base">Company monthly price (USD cents)</label><Input id="billing-base" type="number" min="0" max="100000000" step="1" value={base} onChange={e => setBase(e.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><label htmlFor="billing-worker">Unique reviewed worker price (USD cents)</label><Input id="billing-worker" type="number" min="0" max="100000000" step="1" value={worker} onChange={e => setWorker(e.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><label htmlFor="billing-reason">Reason for this change</label><Input id="billing-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} disabled={busy} /></div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3"><Button disabled={busy || !reason.trim() || tiers.find(t => t.id === selected)?.archived} onClick={() => send(selected ? "revise" : "create")}>{busy ? "Savingâ€¦" : selected ? "Save new revision" : "Create tier"}</Button><Button variant="outline" disabled={busy || !selected || !reason.trim() || tiers.find(t => t.id === selected)?.archived} onClick={() => send("archive")}>Archive tier</Button></div>
    </section>
    <section className="rounded-[2.5rem] border bg-card p-6 sm:p-8" aria-labelledby="company-billing-heading">
      <h2 id="company-billing-heading" className="text-2xl font-medium">Company terms and prepared demos</h2>
      <p className="mt-2 text-sm text-muted-foreground">Assign the selected tier, or choose custom enterprise price above. Assignment pins those prices. Load current company revision before editing. Demo activation requires an existing marked demo; its 48-hour clock starts when saved.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="billing-company">Company ID</label><Input id="billing-company" value={companyId} onChange={e => { setCompanyId(e.target.value); setRevision("0"); }} disabled={busy} /></div><div className="space-y-2"><label htmlFor="billing-revision">Expected company revision</label><Input id="billing-revision" value={revision} readOnly /></div></div>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={usageEnabled} disabled={busy} onChange={e => setUsageEnabled(e.target.checked)} />Explicitly enable commercial usage preview for this company</label>
      <p className="mt-2 text-sm text-muted-foreground">Demo and sandbox usage is excluded. Counts deduplicate human signoffs per company and UTC calendar month. Enabling preview does not create a paid subscription.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Button variant="outline" disabled={busy || !companyId} onClick={loadCompany}>Load company billing</Button><Button disabled={busy || !companyId || !reason.trim() || tiers.find(t => t.id === selected)?.archived} onClick={() => send("assign")}>Assign explicit price</Button><Button variant="outline" disabled={busy || !companyId || !reason.trim()} onClick={() => send("activate_demo")}>Activate 48-hour demo</Button></div>
    </section>
    {message && <p role="status" aria-live="polite" className="rounded-[1.25rem] border p-4 text-sm">{message}</p>}
  </div>;
}

