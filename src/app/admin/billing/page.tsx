import Link from "next/link";
import { connection } from "next/server";
import type { BillingTier } from "@/core/billing";
import { BillingAdminPanel } from "@/components/billing-admin-panel";
import { adminPageSession } from "@/server/auth/admin";
import { listBillingTiers } from "@/server/db/billing";
export default async function BillingPage() {
  await connection(); const { admin, base } = await adminPageSession();
  let tiers: BillingTier[] = [], error: string | null = null;
  try { ({ tiers } = await listBillingTiers(admin)); } catch { error = "Billing catalog unavailable. Check current access and database setup before retrying."; }
  return <main className="mx-auto max-w-5xl px-6 py-12"><Link href={base} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to accounts and leads</Link><h1 className="mt-3 text-4xl font-medium tracking-[-0.02em]">Billing and demos</h1><p className="mt-3 max-w-2xl text-sm text-muted-foreground">Test mode foundations. Stripe checkout, invoices and subscription collection are unavailable. Demo expiry does not delete data or automatically subscribe. Retention, support response and recovery targets remain unconfigured.</p><BillingAdminPanel apiBase={`${base}/api/billing`} initialTiers={tiers} initialError={error} /></main>;
}
