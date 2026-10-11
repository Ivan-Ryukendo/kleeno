import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => mocks, must: (result: { data: unknown; error: unknown }) => {
  if (result.error || result.data === null) throw new Error("fixture database unavailable");
  return result.data;
} }));
vi.mock("@/server/crypto", () => ({
  fingerprint: async (_company: string, value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  sealJson: async (_company: string, _table: string, _field: string, _id: string, value: unknown) => JSON.stringify(value),
  openJson: async (_company: string, _table: string, _field: string, _id: string, value: string) => JSON.parse(value),
}));
import { collectStripeTest, reconcileCollectionCommand } from "@/server/db/billing-collection";
import { reconcileStripeBilling } from "@/server/db/billing-provider";

const companyId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222";
const command = { action: "checkout" as const, expectedBaseCents: 4900, idempotencyKey: "33333333-3333-4333-8333-333333333333" };
const who = { companyId, userId, correlationId: "offline-checkout" };
const config = { key: "sk_test_LOCAL_FIXTURE_ONLY", webhookSecret: "whsec_LOCAL_FIXTURE_ONLY", apiVersion: "2026-02-25.clover" };
const origin = "https://example.com", price = { name: "Fixture", baseCents: 4900, workerCents: 200 };
type Row = Record<string, unknown>;

// This double persists repository hand-offs; SQL locking/RLS/replay arbitration stays in disposable DB acceptance.
function fixture() {
  let collection: Row | null = null, binding: Row | null = null, session: Row | null = null;
  let observation: Row | null = null, lease: unknown = null, revision = 0;
  let loseWriteReply = false, subscriptionCustomer = "cus_fixture";
  const requests: { method: string; url: string; key: string | null; body: URLSearchParams | null }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    const result = () => {
      let data: Row | null;
      if (table === "memberships") data = { roles: ["OWNER"] };
      else if (table === "billing_company_events") data = { id: "assignment", usage_enabled: true, payload_enc: JSON.stringify({ price }) };
      else if (table === "billing_provider_state") data = binding;
      else if (table === "billing_collection_commands") data = collection;
      else throw new Error(`unexpected fixture table ${table}`);
      if (data && [...filters].some(([key, value]) => key in data! && data![key] !== value)) data = null;
      return { data: data ? structuredClone(data) : null, error: null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.set(key, value); return query; }, is: () => query, order: () => query, limit: () => query, maybeSingle: async () => result(), single: async () => result() };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    const data: Row = { code: "OK" };
    switch (name) {
      case "begin_stripe_test_checkout":
        binding = { company_id: companyId, intent_id: args.p_intent, checkout_id: null, customer_id: null, subscription_id: null };
        data.intentId = args.p_intent; break;
      case "prepare_billing_collection":
        collection = { id: args.p_id, company_id: companyId, actor_id: userId, action: args.p_action, command_key: args.p_key, command_hash: args.p_hash, payload_enc: args.p_payload, status: "READY", stage: 0, token: null, checkout_id: null, invoice_id: null, invoice_status: null };
        data.id = args.p_id; break;
      case "claim_billing_collection":
        if (collection?.status !== "READY") data.code = "UNKNOWN";
        else { collection.status = "IN_FLIGHT"; collection.token = args.p_token; data.stage = collection.stage; }
        break;
      case "finish_billing_collection": {
        if (!collection || !binding || collection.token !== args.p_token || collection.stage !== args.p_stage) throw new Error("invalid fixture commit");
        const refs = args.p_refs as Row;
        collection.status = "DONE"; collection.stage = Number(collection.stage) + 1; collection.checkout_id = refs.checkoutId; collection.token = null;
        binding.checkout_id = refs.checkoutId; break;
      }
      case "mark_billing_collection_unknown":
        if (!collection) throw new Error("missing fixture command");
        collection.status = "UNKNOWN"; break;
      case "claim_stripe_test_reconciliation":
        if (!binding?.checkout_id) throw new Error("fixture checkout not bound");
        lease = args.p_token;
        data.state = { intentId: binding.intent_id, checkoutId: binding.checkout_id, customerId: binding.customer_id, subscriptionId: binding.subscription_id, seq: 0 }; break;
      case "finish_stripe_test_reconciliation":
        if (args.p_token !== lease || !binding) throw new Error("invalid fixture lease");
        observation = args.p_observation as Row;
        binding.customer_id = observation.customerId; binding.subscription_id = observation.subscriptionId;
        data.revision = ++revision; lease = null; break;
      case "fail_stripe_test_reconciliation": lease = null; break;
      default: throw new Error(`unexpected fixture RPC ${name}`);
    }
    return { data, error: null };
  });
  const fetchFn = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input), method = options?.method ?? "GET";
    const body = options?.body instanceof URLSearchParams ? options.body : null;
    requests.push({ method, url, key: new Headers(options?.headers).get("Idempotency-Key"), body });
    if (method === "POST" && url.endsWith("/checkout/sessions")) {
      if (!binding || !body) throw new Error("missing fixture checkout intent");
      session = { id: "cs_test_fixture", object: "checkout.session", mode: "subscription", livemode: false, currency: "usd", amount_subtotal: Number(body.get("line_items[0][price_data][unit_amount]")), status: "open", customer: null, subscription: null, metadata: { kleeno_intent: body.get("metadata[kleeno_intent]") }, url: "https://checkout.stripe.com/c/pay/cs_test_fixture" };
      if (loseWriteReply) throw new Error("fixture response lost after provider created Checkout");
      return Response.json(session);
    }
    if (method === "GET" && url.endsWith("/checkout/sessions/cs_test_fixture") && session) return Response.json(session);
    if (method === "GET" && url.endsWith("/subscriptions/sub_fixture") && binding) return Response.json({ id: "sub_fixture", object: "subscription", livemode: false, customer: subscriptionCustomer, metadata: { kleeno_intent: binding.intent_id }, status: "active", cancel_at_period_end: false, pause_collection: null, latest_invoice: "in_fixture" });
    if (method === "GET" && url.endsWith("/invoices/in_fixture")) return Response.json({ id: "in_fixture", object: "invoice", livemode: false, customer: "cus_fixture", subscription: "sub_fixture", status: "paid" });
    throw new Error(`unexpected offline provider request ${method} ${url}`);
  });
  return {
    fetchFn, requests,
    get collection() { return collection; }, get observation() { return observation; },
    loseWriteReply() { loseWriteReply = true; },
    complete(customer = "cus_fixture") {
      if (!session) throw new Error("fixture Checkout not created");
      session = { ...session, status: "complete", customer, subscription: "sub_fixture", url: null };
    },
    foreignSubscription() { subscriptionCustomer = "cus_foreign"; },
  };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network is forbidden in offline Checkout acceptance"); })); });
afterEach(() => { vi.unstubAllGlobals(); });

it("fresh pinned Checkout completes and reconciles a subscription; replay never creates another provider session", async () => {
  const f = fixture();
  const created = await collectStripeTest(who, command, origin, config, f.fetchFn);
  expect(created).toMatchObject({ status: "DONE", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_fixture", entitlement: "UNCONFIGURED" });
  expect(f.requests[0].body?.get("line_items[0][price_data][unit_amount]")).toBe("4900");
  expect(f.requests[0].body?.get("subscription_data[metadata][kleeno_intent]")).toBe(f.requests[0].body?.get("metadata[kleeno_intent]"));
  expect(f.requests[0].key).toBe(`${created.id}:0`);
  expect(mocks.rpc).toHaveBeenCalledWith("begin_stripe_test_checkout", expect.objectContaining({ p_company: companyId, p_actor: userId, p_key: command.idempotencyKey, p_assignment: "assignment" }));
  f.complete();
  await expect(reconcileStripeBilling(who, config, f.fetchFn)).resolves.toMatchObject({ revision: 1, entitlement: "UNCONFIGURED" });
  expect(f.observation).toMatchObject({ checkoutId: "cs_test_fixture", customerId: "cus_fixture", subscriptionId: "sub_fixture", status: "active", invoiceId: "in_fixture", invoiceStatus: "paid" });
  await expect(collectStripeTest(who, command, origin, config, f.fetchFn)).resolves.toMatchObject({ id: created.id, status: "DONE", checkoutUrl: null, entitlement: "UNCONFIGURED" });
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(1);
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "prepare_billing_collection")).toHaveLength(1);
});

it("the same retry key cannot silently change reviewed price or command after fresh Checkout", async () => {
  const f = fixture();
  await collectStripeTest(who, command, origin, config, f.fetchFn);
  const before = f.requests.length;
  await expect(collectStripeTest(who, { ...command, expectedBaseCents: 5000 }, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.requests).toHaveLength(before);
});

it("a lost successful Checkout reply stays UNKNOWN until exact-object GET recovery; retry sends no replacement", async () => {
  const f = fixture(); f.loseWriteReply();
  await expect(collectStripeTest(who, command, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.collection?.status).toBe("UNKNOWN");
  await expect(collectStripeTest(who, command, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.requests).toHaveLength(1);
  const id = String(f.collection?.id);
  await expect(reconcileCollectionCommand(who, id, "cs_test_fixture", config, f.fetchFn)).resolves.toMatchObject({ id, status: "DONE" });
  f.complete();
  await expect(reconcileStripeBilling(who, config, f.fetchFn)).resolves.toMatchObject({ entitlement: "UNCONFIGURED" });
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(1);
});

it("a completed Checkout with a foreign subscription customer cannot publish observed subscription state", async () => {
  const f = fixture();
  await collectStripeTest(who, command, origin, config, f.fetchFn);
  f.complete(); f.foreignSubscription();
  await expect(reconcileStripeBilling(who, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.observation).toBeNull();
  expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_stripe_test_reconciliation")).toBe(false);
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(1);
});
