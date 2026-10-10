import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCheckout, parseStripeHint, readWebhookBody, stripeBillingConfig, stripeGet, stripeWrite, verifyStripeSignature } from "@/server/stripe-billing";
const key = "sk_test_LOCAL_FIXTURE_ONLY", secret = "whsec_LOCAL_FIXTURE_ONLY";
const raw = Buffer.from(JSON.stringify({ id: "evt_test", object: "event", livemode: false, type: "customer.subscription.updated", created: 1, data: { object: { id: "sub_test", object: "subscription", livemode: false, customer: "cus_test", status: "active", metadata: { companyId: "do-not-trust" } } } }));
const signature = (body = raw, time = 1000) => `t=${time},v1=${createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex")}`;
beforeEach(() => vi.restoreAllMocks());
describe("Stripe TEST contract", () => {
  it("rejects absent/live keys and requires explicit API version", () => {
    expect(stripeBillingConfig({})).toBeNull();
    expect(stripeBillingConfig({ STRIPE_TEST_SECRET_KEY: "sk_live_rejected", STRIPE_TEST_WEBHOOK_SECRET: secret, STRIPE_TEST_API_VERSION: "2026-02-25.clover" })).toBeNull();
    expect(stripeBillingConfig({ STRIPE_TEST_SECRET_KEY: key, STRIPE_TEST_WEBHOOK_SECRET: secret })).toBeNull();
  });
  it("verifies exact bytes, v1, secret rotation, timestamp recency and timing-safe HMAC", () => {
    expect(verifyStripeSignature(raw, signature(), secret, 1000)).toBe(true);
    expect(verifyStripeSignature(raw, `t=1000,v1=${"0".repeat(64)},${signature().split(",")[1]}`, secret, 1000)).toBe(true);
    for (const header of [signature(), "t=1000,v0=" + signature().split("v1=")[1], "t=1000,v1=bad", signature(raw, 699), signature(raw, 1301), "t=1000,t=1001,v1=" + signature().split("v1=")[1]]) {
      const body = header === signature() ? Buffer.from(" " + raw.toString()) : raw;
      expect(verifyStripeSignature(body, header, secret, 1000)).toBe(false);
    }
  });
  it("projects allowlisted object references and rejects live/Connect/thin data", () => {
    const hint = parseStripeHint(raw);
    expect(hint).toEqual({ eventId: "evt_test", type: "customer.subscription.updated", objectId: "sub_test", objectType: "subscription", customerId: "cus_test", subscriptionId: "sub_test" });
    expect(JSON.stringify(hint)).not.toContain("companyId");
    const body = JSON.parse(raw.toString());
    expect(() => parseStripeHint(Buffer.from(JSON.stringify({ ...body, livemode: true })))).toThrow();
    expect(() => parseStripeHint(Buffer.from(JSON.stringify({ ...body, account: "acct_other" })))).toThrow();
    expect(() => parseStripeHint(Buffer.from(JSON.stringify({ ...body, data: {} })))).toThrow();
  });
  it("bounds actual raw body bytes even without content-length", async () => {
    await expect(readWebhookBody(new Request("http://localhost", { method: "POST", body: "a".repeat(256 * 1024 + 1) }))).rejects.toThrow("TOO_LARGE");
  });
  it("rejects inconsistent invoice subscription references instead of choosing one", () => {
    const body = { id: "evt_invoice", object: "event", livemode: false, type: "invoice.paid", data: { object: { id: "in_test", object: "invoice", livemode: false, customer: "cus_test", subscription: "sub_test", parent: { subscription_details: { subscription: "sub_other" } } } } };
    expect(() => parseStripeHint(Buffer.from(JSON.stringify(body)))).toThrow("STRIPE_BINDING_MISMATCH");
  });
  it("builds checkout only from pinned server price/intent, sends no worker facts", () => {
    const body = buildTestCheckout({ intentId: "11111111-1111-4111-8111-111111111111", price: { name: "Review", baseCents: 4900, workerCents: 200 }, successUrl: "https://example.com/settings/billing", cancelUrl: "https://example.com/settings/billing" });
    expect(body.get("mode")).toBe("subscription"); expect(body.get("line_items[0][price_data][unit_amount]")).toBe("4900"); expect(body.get("subscription_data[metadata][kleeno_intent]")).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.toString()).not.toContain("worker");
  });
  it("current-object read uses pinned API version/test key and rejects live object", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sub_test", livemode: true }), { status: 200 }));
    await expect(stripeGet("subscriptions", "sub_test", { key, webhookSecret: secret, apiVersion: "2026-02-25.clover" }, fetchFn)).rejects.toThrow("STRIPE_INVALID_OBJECT");
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.stripe.com/v1/subscriptions/sub_test");
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${key}`, "Stripe-Version": "2026-02-25.clover" });
  });
  it("provider writes use stable scoped idempotency keys and fail closed on uncertain/live replies", async () => {
    const config = { key, webhookSecret: secret, apiVersion: "2026-02-25.clover" };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sub_test", object: "subscription", livemode: false })));
    await stripeWrite("subscriptions/sub_test", new URLSearchParams({ cancel_at_period_end: "true", proration_behavior: "none" }), "11111111-1111-4111-8111-111111111111:0", config, fetchFn);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111:0", "Stripe-Version": config.apiVersion } });
    for (const result of [new Response(JSON.stringify({ id: "sub_test", livemode: true })), new Response("PRIVATE_PROVIDER_CANARY", { status: 500 })]) {
      fetchFn.mockResolvedValueOnce(result);
      await expect(stripeWrite("subscriptions/sub_test", new URLSearchParams(), "11111111-1111-4111-8111-111111111111:0", config, fetchFn)).rejects.toThrow("STRIPE_WRITE_UNKNOWN");
    }
    await expect(stripeWrite("customers/cus_test" as never, new URLSearchParams(), "invalid", config, fetchFn)).rejects.toThrow();
  });
});
