"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function BillingProviderRefresh({ available }: { available: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  async function refresh() {
    setBusy(true); setMessage(null);
    try { const response = await fetch("/api/billing/reconcile", { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Provider reconciliation failed"); setMessage("Current Stripe TEST status reconciled. Software entitlement remains unconfigured."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Provider reconciliation failed"); } finally { setBusy(false); }
  }
  return <div className="mt-4"><Button variant="outline" disabled={!available || busy} onClick={refresh}>{busy ? "Reconciling…" : "Refresh Stripe TEST status"}</Button>{message && <p role="status" className="mt-3 text-sm">{message}</p>}</div>;
}
