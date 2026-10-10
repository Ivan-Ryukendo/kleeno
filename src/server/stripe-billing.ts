import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PriceSchema, type Price } from "@/core/billing";
const MAX_BODY = 256 * 1024;
const configSchema = z.object({ key: z.string().regex(/^sk_test_[A-Za-z0-9_]+$/), webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9_]+$/), apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/) }).strict();
export type StripeBillingConfig = z.infer<typeof configSchema>;
export function stripeBillingConfig(values: Record<string, string | undefined> = process.env): StripeBillingConfig | null {
  const result = configSchema.safeParse({ key: values.STRIPE_TEST_SECRET_KEY, webhookSecret: values.STRIPE_TEST_WEBHOOK_SECRET, apiVersion: values.STRIPE_TEST_API_VERSION });
  return result.success ? result.data : null;
}
export function verifyStripeSignature(raw: Uint8Array, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!header || header.length > 4096 || raw.length > MAX_BODY || !/^whsec_[A-Za-z0-9_]+$/.test(secret)) return false;
  const pieces = header.split(",").map(part => part.trim().split("="));
  const times = pieces.filter(([name]) => name === "t");
  if (times.length !== 1 || !/^\d+$/.test(times[0][1] ?? "")) return false;
  const time = Number(times[0][1]); if (!Number.isSafeInteger(time) || Math.abs(now - time) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${times[0][1]}.`).update(raw).digest();
  return pieces.filter(([name, value]) => name === "v1" && /^[a-f0-9]{64}$/.test(value ?? "")).some(([, value]) => timingSafeEqual(expected, Buffer.from(value, "hex")));
}
export async function readWebhookBody(request: Pick<Request, "body" | "headers">): Promise<Buffer> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new Error("TOO_LARGE");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > MAX_BODY) { await reader.cancel(); throw new Error("TOO_LARGE"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const id = (prefix: string) => z.string().max(255).regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const ref = (prefix: string) => z.union([id(prefix), z.object({ id: id(prefix) })]).transform(value => typeof value === "string" ? value : value.id);
const hintObject = z.object({ id: z.string().max(255), object: z.enum(["subscription", "invoice", "checkout.session"]), livemode: z.literal(false), customer: ref("cus").nullable().optional(), subscription: ref("sub").nullable().optional(), parent: z.object({ subscription_details: z.object({ subscription: ref("sub") }).nullable().optional() }).nullable().optional() });
const event = z.object({ id: id("evt"), object: z.literal("event"), livemode: z.literal(false), account: z.never().optional(), context: z.never().optional(), type: z.enum(["checkout.session.completed", "checkout.session.expired", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "invoice.finalized", "invoice.voided", "invoice.marked_uncollectible"]), data: z.object({ object: hintObject }) });
export interface StripeHint { eventId: string; type: string; objectId: string; objectType: "subscription" | "invoice" | "checkout.session"; customerId: string | null; subscriptionId: string | null }
export function stripeSubscriptionReference(object: { subscription?: string | null; parent?: { subscription_details?: { subscription?: string | null } | null } | null }): string | null {
  const direct = object.subscription, parent = object.parent?.subscription_details?.subscription;
  if (direct && parent && direct !== parent) throw new Error("STRIPE_BINDING_MISMATCH");
  return direct ?? parent ?? null;
}
export function parseStripeHint(raw: Uint8Array): StripeHint {
  const parsed = event.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))); const object = parsed.data.object;
  const prefix = object.object === "subscription" ? "sub" : object.object === "invoice" ? "in" : "cs_test";
  id(prefix).parse(object.id);
  if ((parsed.type.startsWith("customer.subscription.") && object.object !== "subscription") || (parsed.type.startsWith("invoice.") && object.object !== "invoice") || (parsed.type.startsWith("checkout.") && object.object !== "checkout.session")) throw new Error("STRIPE_INVALID_EVENT");
  return { eventId: parsed.id, type: parsed.type, objectId: object.id, objectType: object.object, customerId: object.customer ?? null, subscriptionId: object.object === "subscription" ? object.id : stripeSubscriptionReference(object) };
}
/** Pinned TEST monthly base. Worker usage is separately invoiced after the UTC month closes. */
export function buildTestCheckout(input: { intentId: string; price: Price; successUrl: string; cancelUrl: string }) {
  z.string().uuid().parse(input.intentId); PriceSchema.parse(input.price);
  for (const url of [input.successUrl, input.cancelUrl]) if (new URL(url).protocol !== "https:") throw new Error("STRIPE_INVALID_RETURN_URL");
  return new URLSearchParams({ mode: "subscription", success_url: input.successUrl, cancel_url: input.cancelUrl,
    "metadata[kleeno_intent]": input.intentId, "subscription_data[metadata][kleeno_intent]": input.intentId,
    "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(input.price.baseCents), "line_items[0][price_data][recurring][interval]": "month", "line_items[0][price_data][product_data][name]": input.price.name, "line_items[0][quantity]": "1" });
}
export type StripeWritePath = "checkout/sessions" | "invoices" | "invoiceitems" | `subscriptions/${string}` | `invoices/${string}/finalize`;
/** A response failure is always uncertain. The durable caller must stop, never invent a new retry key. */
export async function stripeWrite(path: StripeWritePath, body: URLSearchParams, idempotencyKey: string, config: StripeBillingConfig, fetchFn: typeof fetch = fetch): Promise<Record<string, unknown>> {
  configSchema.parse(config); z.string().regex(/^[0-9a-f-]{36}:\d$/).parse(idempotencyKey);
  if (!["checkout/sessions", "invoices", "invoiceitems"].includes(path) && !/^subscriptions\/sub_[A-Za-z0-9_]+$/.test(path) && !/^invoices\/in_[A-Za-z0-9_]+\/finalize$/.test(path)) throw new Error("STRIPE_INVALID_WRITE");
  try {
    const response = await fetchFn(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Stripe-Version": config.apiVersion, "Idempotency-Key": idempotencyKey, "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("rejected");
    const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readWebhookBody(response)));
    if (!object || object.livemode !== false || typeof object.id !== "string") throw new Error("invalid");
    return object;
  } catch { throw new Error("STRIPE_WRITE_UNKNOWN"); }
}
export async function stripeGet(kind: "subscriptions" | "invoices" | "invoiceitems" | "checkout/sessions", objectId: string, config: StripeBillingConfig, fetchFn: typeof fetch = fetch): Promise<Record<string, unknown>> {
  configSchema.parse(config); id(kind === "subscriptions" ? "sub" : kind === "invoices" ? "in" : kind === "invoiceitems" ? "ii" : "cs_test").parse(objectId);
  let response: Response;
  try { response = await fetchFn(`https://api.stripe.com/v1/${kind}/${encodeURIComponent(objectId)}`, { headers: { Authorization: `Bearer ${config.key}`, "Stripe-Version": config.apiVersion }, cache: "no-store", signal: AbortSignal.timeout(10000) }); } catch { throw new Error("STRIPE_UNAVAILABLE"); }
  if (!response.ok) throw new Error("STRIPE_UNAVAILABLE");
  const raw = await readWebhookBody(response);
  let object: Record<string, unknown>;
  try { object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { throw new Error("STRIPE_INVALID_OBJECT"); }
  if (object.id !== objectId || object.livemode !== false) throw new Error("STRIPE_INVALID_OBJECT"); return object;
}
