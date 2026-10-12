import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), open: vi.fn(), from: vi.fn(), allowed: true }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.open, fingerprint: async () => "a".repeat(64), sealJson: async () => "encrypted" }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }), must: (value: { data: unknown; error: unknown }) => { if (value.error || value.data === null) throw new Error("database unavailable"); return value.data; } }));
import { collectStripeTest, reconcileCollectionCommand } from "@/server/db/billing-collection";
const companyId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222", commandId = "33333333-3333-4333-8333-333333333333", intentId = "44444444-4444-4444-8444-444444444444";
const who = { companyId, userId, correlationId: "fixture-request" }, config = { key: "sk_test_LOCAL_FIXTURE_ONLY", webhookSecret: "whsec_LOCAL_FIXTURE_ONLY", apiVersion: "2026-02-25.clover" };
let current: Record<string, unknown>, payload: Record<string, unknown>;
const invoice = (status = "draft", total = 0, subscription = "sub_fixture") => ({ id: "in_fixture", object: "invoice", livemode: false, customer: "cus_fixture", currency: "usd", subscription, metadata: { kleeno_command: commandId }, status, total, lines: { has_more: false, data: total ? [{ amount: total, metadata: { kleeno_command: commandId } }] : [] } });
const item = { id: "ii_fixture", object: "invoiceitem", livemode: false, customer: "cus_fixture", invoice: "in_fixture", amount: 200, currency: "usd", metadata: { kleeno_command: commandId } };
const fixtures = (...objects: unknown[]) => { const fetchFn = vi.fn(); for (const object of objects) fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(object))); return fetchFn; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true;
  current = { id: commandId, company_id: companyId, actor_id: userId, action: "usage", command_key: intentId, command_hash: "a".repeat(64), payload_enc: "ciphertext", status: "READY", stage: 0, token: null, invoice_id: null, item_id: null, checkout_id: null, invoice_status: null };
  payload = { action: "usage", intentId, customerId: "cus_fixture", subscriptionId: "sub_fixture", price: null, amountCents: 200, uniqueWorkers: 1, month: "2026-09-01", sourceHash: "b".repeat(64) };
  mocks.open.mockImplementation(async () => payload);
  mocks.from.mockImplementation((table: string) => {
    const data = () => table === "memberships" ? { roles: mocks.allowed ? ["OWNER"] : [] } : table === "billing_provider_state" ? { customer_id: "cus_fixture", subscription_id: "sub_fixture" } : current;
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: data(), error: null }), single: async () => ({ data: { ...data() }, error: null }) }; return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_billing_collection") {
      if (current.status !== "READY") return { data: { code: "UNKNOWN" }, error: null };
      current.token = args.p_token; current.status = "IN_FLIGHT"; return { data: { code: "OK", stage: current.stage }, error: null };
    }
    if (name === "finish_billing_collection") {
      current.stage = Number(current.stage) + 1; current.status = args.p_done ? "DONE" : "READY";
      const refs = args.p_refs as Record<string, unknown>; current.invoice_id = refs.invoiceId ?? current.invoice_id; current.item_id = refs.itemId ?? current.item_id; current.invoice_status = refs.invoiceStatus ?? current.invoice_status;
    }
    if (name === "mark_billing_collection_unknown") current.status = "UNKNOWN";
    return { data: { code: "OK" }, error: null };
  });
});
it("creates only isolated pinned-amount usage draft/item/finalization, retaining exact stable step keys", async () => {
  const fetchFn = fixtures(invoice(), invoice(), item, invoice("draft", 200), invoice("open", 200));
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).resolves.toMatchObject({ status: "DONE", invoiceId: "in_fixture", invoiceStatus: "open", entitlement: "UNCONFIGURED" });
  const writes = fetchFn.mock.calls.filter(([, options]) => options.method === "POST");
  expect(writes.map(([, options]) => options.headers["Idempotency-Key"])).toEqual([`${commandId}:0`, `${commandId}:1`, `${commandId}:2`]);
  expect(writes[0][1].body.get("pending_invoice_items_behavior")).toBe("exclude");
  expect(writes[1][1].body.get("invoice")).toBe("in_fixture"); expect(writes[1][1].body.get("amount")).toBe("200");
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_billing_collection", "finish_billing_collection", "claim_billing_collection", "finish_billing_collection", "claim_billing_collection", "finish_billing_collection"]);
});
it("rejects a provider invoice attached to another subscription before binding or creating further charges", async () => {
  const fetchFn = fixtures(invoice("draft", 0, "sub_foreign"));
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN"); expect(fetchFn).toHaveBeenCalledTimes(1);
});
it("uncertain outcomes cannot replay writes or acquire another provider stage", async () => {
  current.status = "UNKNOWN"; const fetchFn = vi.fn();
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fetchFn).not.toHaveBeenCalled();
});
it("current membership is required before any provider request", async () => {
  mocks.allowed = false; const fetchFn = vi.fn();
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fetchFn).not.toHaveBeenCalled();
});
it("late-source or token conflict after a provider write preserves UNKNOWN without a replacement charge", async () => {
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "finish_billing_collection" ? { data: { code: "CONFLICT" }, error: null } : original(name, args));
  const fetchFn = fixtures(invoice());
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN"); expect(fetchFn).toHaveBeenCalledTimes(1);
});
it("explicit uncertain-invoice recovery uses a current-object GET and original token/stage CAS, no mutation", async () => {
  current.status = "UNKNOWN"; current.token = intentId;
  const fetchFn = fixtures(invoice());
  await expect(reconcileCollectionCommand(who, commandId, "in_fixture", config, fetchFn)).resolves.toMatchObject({ status: "READY", entitlement: "UNCONFIGURED" });
  expect(fetchFn.mock.calls[0][1].method).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledWith("finish_billing_collection", expect.objectContaining({ p_token: intentId, p_stage: 0, p_done: false, p_refs: { invoiceId: "in_fixture", invoiceStatus: "draft" } }));
});
it("Checkout requires the pinned TEST base amount and exact intent; a mismatched quote stays UNKNOWN", async () => {
  current.action = "checkout"; payload = { ...payload, action: "checkout", customerId: null, subscriptionId: null, month: null, price: { name: "Review", baseCents: 4900, workerCents: 200 }, amountCents: 0, uniqueWorkers: 0 };
  const fetchFn = fixtures({ id: "cs_test_fixture", object: "checkout.session", mode: "subscription", livemode: false, currency: "usd", amount_subtotal: 1, status: "open", customer: null, subscription: null, metadata: { kleeno_intent: intentId }, url: "https://checkout.stripe.com/c/pay/cs_test_fixture" });
  await expect(collectStripeTest(who, { action: "checkout", expectedBaseCents: 4900, idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN");
});
it("period-end cancellation never changes prices or authorizes payment", async () => {
  current.action = "cancel"; payload = { ...payload, action: "cancel", month: null };
  const fetchFn = fixtures({ id: "sub_fixture", object: "subscription", livemode: false, customer: "cus_fixture", cancel_at_period_end: true });
  await expect(collectStripeTest(who, { action: "cancel", idempotencyKey: intentId }, "https://example.com", config, fetchFn)).resolves.toMatchObject({ status: "DONE", entitlement: "UNCONFIGURED" });
  expect(fetchFn.mock.calls[0][1].body.toString()).toBe("cancel_at_period_end=true&proration_behavior=none");
});
it("uncertain recovery rejects conflicting subscription references and cannot commit", async () => {
  current.status = "UNKNOWN"; current.token = intentId;
  const fetchFn = fixtures({ ...invoice(), parent: { subscription_details: { subscription: "sub_foreign" } } });
  await expect(reconcileCollectionCommand(who, commandId, "in_fixture", config, fetchFn)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("Checkout replay cannot return a redirect from a wrong mode or known subscription binding", async () => {
  current.action = "checkout"; current.status = "DONE"; current.checkout_id = "cs_test_fixture";
  payload = { ...payload, action: "checkout", customerId: null, subscriptionId: null, month: null, price: { name: "Review", baseCents: 4900, workerCents: 200 } };
  const session = { id: "cs_test_fixture", object: "checkout.session", mode: "subscription", livemode: false, currency: "usd", amount_subtotal: 4900, metadata: { kleeno_intent: intentId }, url: "https://checkout.stripe.com/c/pay/cs_test_fixture", status: "open", customer: "cus_fixture", subscription: "sub_foreign" };
  await expect(collectStripeTest(who, { action: "checkout", expectedBaseCents: 4900, idempotencyKey: intentId }, "https://example.com", config, fixtures(session))).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(collectStripeTest(who, { action: "checkout", expectedBaseCents: 4900, idempotencyKey: intentId }, "https://example.com", config, fixtures({ ...session, mode: "payment" }))).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("finalization must retain the single exact command line, even when a foreign line has the same total", async () => {
  const finalized = invoice("open", 200); finalized.lines.data[0].metadata.kleeno_command = intentId;
  const fetchFn = fixtures(invoice(), invoice(), item, invoice("draft", 200), finalized);
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: 200, expectedSourceHash: "b".repeat(64), idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN"); expect(current.stage).toBe(2);
});
function freshCommandSources() {
  mocks.from.mockImplementation((table: string) => {
    const data = () => table === "memberships" ? { roles: ["OWNER"] } : table === "billing_provider_state" ? { intent_id: intentId, customer_id: "cus_fixture", subscription_id: "sub_fixture" } : table === "billing_company_events" ? { id: intentId, usage_enabled: true, payload_enc: "price" } : null;
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: data(), error: null }), single: async () => ({ data: current, error: null }), then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) }; return query;
  });
}
it("fresh Checkout refuses a changed base quote before recording an intent or contacting Stripe", async () => {
  freshCommandSources(); mocks.open.mockResolvedValue({ price: { name: "Review", baseCents: 5000, workerCents: 200 } });
  const fetchFn = vi.fn();
  await expect(collectStripeTest(who, { action: "checkout", expectedBaseCents: 4900, idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
});
for (const [amount, hash] of [[200, "a".repeat(64)], [0, "b".repeat(64)]] as const) it(`fresh usage command requires both reviewed amount and source CAS (${amount})`, async () => {
  freshCommandSources(); const fetchFn = vi.fn();
  await expect(collectStripeTest(who, { action: "usage", month: "2026-09-01", expectedAmountCents: amount, expectedSourceHash: hash, idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
});

it("fresh cancellation prepares one durable command and replays DONE without another provider write", async () => {
  freshCommandSources(); current.action = "cancel";
  payload = { ...payload, action: "cancel", month: null, sourceHash: null, amountCents: 0, uniqueWorkers: 0 };
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "prepare_billing_collection" ? { data: { code: "OK", id: commandId }, error: null } : original(name, args));
  const fetchFn = fixtures({ id: "sub_fixture", object: "subscription", livemode: false, customer: "cus_fixture", cancel_at_period_end: true });
  const command = { action: "cancel" as const, idempotencyKey: intentId };
  await expect(collectStripeTest(who, command, "https://example.com", config, fetchFn)).resolves.toMatchObject({ status: "DONE", entitlement: "UNCONFIGURED" });
  expect(mocks.rpc).toHaveBeenCalledWith("prepare_billing_collection", expect.objectContaining({ p_action: "cancel", p_month: null, p_usage: [], p_key: intentId }));
  expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("billing_company_events");
  expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("billing_worker_usage");
  expect(fetchFn.mock.calls[0]).toEqual(["https://api.stripe.com/v1/subscriptions/sub_fixture", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "Idempotency-Key": `${commandId}:0` }), body: new URLSearchParams({ cancel_at_period_end: "true", proration_behavior: "none" }) })]);
  // Reuse the existing prepared-command fixture for the exact-key DONE replay.
  const preparedQueries = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((table: string) => {
    if (table !== "billing_collection_commands") return preparedQueries(table);
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: current, error: null }), single: async () => ({ data: current, error: null }) };
    return query;
  });
  const callsBefore = mocks.rpc.mock.calls.length;
  await expect(collectStripeTest(who, command, "https://example.com", config, fetchFn)).resolves.toMatchObject({ status: "DONE", entitlement: "UNCONFIGURED" });
  expect(fetchFn).toHaveBeenCalledTimes(1); expect(mocks.rpc.mock.calls).toHaveLength(callsBefore);
});

it("lost cancellation response stays UNKNOWN; exact bound GET alone completes the original stage", async () => {
  current.action = "cancel"; payload = { ...payload, action: "cancel", month: null };
  const command = { action: "cancel" as const, idempotencyKey: intentId }, fetchFn = vi.fn().mockRejectedValue(new Error("PRIVATE_CANCEL_CANARY"));
  await expect(collectStripeTest(who, command, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN"); const token = current.token;
  await expect(collectStripeTest(who, command, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fetchFn).toHaveBeenCalledTimes(1);
  const read = fixtures({ id: "sub_fixture", livemode: false, customer: "cus_fixture", cancel_at_period_end: true });
  await expect(reconcileCollectionCommand(who, commandId, "sub_fixture", config, read)).resolves.toEqual({ id: commandId, status: "DONE", entitlement: "UNCONFIGURED" });
  expect(read.mock.calls[0][1].method).toBeUndefined();
  expect(mocks.rpc).toHaveBeenLastCalledWith("finish_billing_collection", expect.objectContaining({ p_id: commandId, p_token: token, p_stage: 0, p_refs: { subscriptionId: "sub_fixture" }, p_done: true }));
});

it.each([
  ["foreign customer", { customer: "cus_foreign" }],
  ["foreign subscription", { id: "sub_foreign" }],
  ["noncancelled subscription", { cancel_at_period_end: false }],
])("cancellation %s reply remains UNKNOWN without claiming success", async (_reason, changes) => {
  current.action = "cancel"; payload = { ...payload, action: "cancel", month: null };
  const fetchFn = fixtures({ id: "sub_fixture", object: "subscription", livemode: false, customer: "cus_fixture", cancel_at_period_end: true, ...changes });
  await expect(collectStripeTest(who, { action: "cancel", idempotencyKey: intentId }, "https://example.com", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(current.status).toBe("UNKNOWN"); expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_billing_collection", "mark_billing_collection_unknown"]);
});

it("uncertain cancellation recovery refuses foreign object and unobserved cancellation", async () => {
  current.action = "cancel"; current.status = "UNKNOWN"; current.token = intentId;
  payload = { ...payload, action: "cancel", month: null };
  const fetchFn = fixtures({ id: "sub_fixture", livemode: false, customer: "cus_fixture", cancel_at_period_end: false });
  await expect(reconcileCollectionCommand(who, commandId, "sub_foreign", config, fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fetchFn).not.toHaveBeenCalled();
  await expect(reconcileCollectionCommand(who, commandId, "sub_fixture", config, fetchFn)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(current.status).toBe("UNKNOWN");
});
