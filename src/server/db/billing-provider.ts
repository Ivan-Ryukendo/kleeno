import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { WorkflowError } from "@/core/workflow";
import { sealJson } from "@/server/crypto";
import { stripeBillingConfig, stripeGet, stripeSubscriptionReference, type StripeBillingConfig, type StripeHint } from "@/server/stripe-billing";
import { db, must } from "./client";
type Owner = { companyId: string; userId: string; correlationId?: string };
const statuses = z.enum(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);
const providerId = (prefix: string) => z.string().max(255).regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const expanded = (prefix: string) => z.union([providerId(prefix), z.object({ id: providerId(prefix) })]).transform(value => typeof value === "string" ? value : value.id);
const sessionSchema = z.object({ id: providerId("cs_test"), object: z.literal("checkout.session"), livemode: z.literal(false), mode: z.literal("subscription"), status: z.enum(["open", "complete", "expired"]), metadata: z.object({ kleeno_intent: z.string().uuid() }), customer: expanded("cus").nullable(), subscription: expanded("sub").nullable() });
const subscriptionSchema = z.object({ id: providerId("sub"), object: z.literal("subscription"), livemode: z.literal(false), customer: expanded("cus"), metadata: z.object({ kleeno_intent: z.string().uuid() }), status: statuses, cancel_at_period_end: z.boolean(), pause_collection: z.unknown().nullable().optional(), latest_invoice: expanded("in").nullable() });
const invoiceSchema = z.object({ id: providerId("in"), object: z.literal("invoice"), livemode: z.literal(false), customer: expanded("cus"), status: z.enum(["draft", "open", "paid", "uncollectible", "void"]), subscription: expanded("sub").nullable().optional(), parent: z.object({ subscription_details: z.object({ subscription: expanded("sub") }).nullable().optional() }).nullable().optional() });
export async function loadBillingProvider(companyId: string) {
  const result = await db().from("billing_provider_state").select("status,cancel_at_period_end,collection_paused,invoice_status,observed_at,reconciliation_pending,revision").eq("company_id", companyId).maybeSingle();
  if (result.error) throw new Error("billing provider status unavailable");
  return { mode: "TEST", configured: stripeBillingConfig() !== null, linked: !!result.data, status: result.data?.status ?? "NOT_LINKED", cancelAtPeriodEnd: result.data?.cancel_at_period_end ?? false, collectionPaused: result.data?.collection_paused ?? false, invoiceStatus: result.data?.invoice_status ?? null, observedAt: result.data?.observed_at ?? null, reconciliation: result.data?.reconciliation_pending ? "PENDING" : result.data?.observed_at ? "CURRENT" : "UNVERIFIED", entitlement: "UNCONFIGURED", collectionPolicy: "UNCONFIGURED", revision: result.data?.revision ?? 0 };
}
export async function recordStripeReceipt(hint: StripeHint, raw: Uint8Array) {
  if (hint.objectType !== "checkout.session" && !hint.subscriptionId) return append(null, hint, raw);
  let query = db().from("billing_provider_state").select("company_id,customer_id,subscription_id,checkout_id");
  if (hint.objectType === "checkout.session") query = query.eq("checkout_id", hint.objectId);
  else if (hint.subscriptionId) query = query.eq("subscription_id", hint.subscriptionId);
  const matched = await query.maybeSingle();
  if (matched.error) throw new Error("billing webhook binding unavailable");
  if (matched.data?.customer_id && hint.customerId && matched.data.customer_id !== hint.customerId) throw new WorkflowError("CONFLICT", "Provider customer binding does not match");
  return append(matched.data?.company_id ?? null, hint, raw);
}
async function append(companyId: string | null, hint: StripeHint, raw: Uint8Array) {
  const result = must(await db().rpc("record_stripe_test_receipt", { p_company: companyId, p_event: hint.eventId, p_hash: createHash("sha256").update(raw).digest("hex"), p_type: hint.type, p_object: hint.objectId, p_customer: hint.customerId, p_subscription: hint.subscriptionId, p_refs_enc: companyId ? await sealJson(companyId, "billing_webhook_receipts", "refs_enc", hint.eventId, hint) : null }), "billing webhook receipt") as { code: string; duplicate?: boolean; matched?: boolean };
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Provider event was reused or its binding changed");
  return { ok: true, duplicate: result.duplicate ?? false, matched: result.matched ?? false };
}
interface Claimed { intentId: string; checkoutId: string; customerId: string | null; subscriptionId: string | null; seq: number }
export async function reconcileStripeBilling(who: Owner, config: StripeBillingConfig | null = stripeBillingConfig(), fetchFn: typeof fetch = fetch) {
  if (!config) throw new WorkflowError("CONFLICT", "Stripe TEST setup is unconfigured");
  const token = randomUUID();
  const claim = must(await db().rpc("claim_stripe_test_reconciliation", { p_company: who.companyId, p_actor: who.userId, p_token: token }), "billing reconciliation claim") as { code: string; state?: Claimed };
  if (claim.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current company Owner access is required");
  if (claim.code !== "OK" || !claim.state) throw new WorkflowError("CONFLICT", claim.code === "NOT_LINKED" ? "No server-bound Stripe TEST checkout exists" : "Billing reconciliation is already in progress");
  try {
    const bound = claim.state;
    const session = sessionSchema.parse(await stripeGet("checkout/sessions", bound.checkoutId, config, fetchFn));
    if (session.metadata.kleeno_intent !== bound.intentId || (bound.customerId && session.customer !== bound.customerId) || (bound.subscriptionId && session.subscription !== bound.subscriptionId)) throw new Error("STRIPE_BINDING_MISMATCH");
    let status: string = session.status === "expired" ? "CHECKOUT_EXPIRED" : "UNKNOWN", cancelAtPeriodEnd = false, collectionPaused = false, invoiceId: string | null = null, invoiceStatus: string | null = null;
    if (session.subscription) {
      if (!session.customer) throw new Error("STRIPE_BINDING_MISMATCH");
      const subscription = subscriptionSchema.parse(await stripeGet("subscriptions", session.subscription, config, fetchFn));
      if (subscription.customer !== session.customer || subscription.metadata.kleeno_intent !== bound.intentId) throw new Error("STRIPE_BINDING_MISMATCH");
      // Paused collection can retain active status. Do not project this into an entitlement.
      status = subscription.status; cancelAtPeriodEnd = subscription.cancel_at_period_end; collectionPaused = subscription.pause_collection != null; invoiceId = subscription.latest_invoice;
      if (invoiceId) {
        const invoice = invoiceSchema.parse(await stripeGet("invoices", invoiceId, config, fetchFn));
        if (invoice.customer !== session.customer || stripeSubscriptionReference(invoice) !== session.subscription) throw new Error("STRIPE_BINDING_MISMATCH");
        invoiceStatus = invoice.status;
      }
    }
    const result = must(await db().rpc("finish_stripe_test_reconciliation", { p_company: who.companyId, p_actor: who.userId, p_token: token, p_seq: bound.seq, p_correlation: who.correlationId ?? randomUUID(), p_observation: { intentId: bound.intentId, checkoutId: bound.checkoutId, customerId: session.customer, subscriptionId: session.subscription, status, cancelAtPeriodEnd, collectionPaused, invoiceId, invoiceStatus } }), "billing reconciliation commit") as { code: string; revision?: number };
    if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current company Owner access is required");
    if (result.code !== "OK") throw new WorkflowError("CONFLICT", "New provider evidence arrived; reconcile again before trusting billing status");
    return { revision: result.revision, entitlement: "UNCONFIGURED" };
  } catch (error) {
    await db().rpc("fail_stripe_test_reconciliation", { p_company: who.companyId, p_token: token });
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError("CONFLICT", "Stripe TEST reconciliation failed; provider state remains pending");
  }
}
