import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), seal: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }), must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data === null) throw new Error("database unavailable"); return result.data; } }));
vi.mock("@/server/crypto", () => ({ sealJson: mocks.seal }));
import { loadBillingProvider, reconcileStripeBilling, recordStripeReceipt } from "@/server/db/billing-provider";
const companyId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222", intentId = "33333333-3333-4333-8333-333333333333";
const who = { companyId, userId, correlationId: "fixture-request" };
const config = { key: "sk_test_LOCAL_FIXTURE_ONLY", webhookSecret: "whsec_LOCAL_FIXTURE_ONLY", apiVersion: "2026-02-25.clover" };
const bound = { intentId, checkoutId: "cs_test_fixture", customerId: "cus_fixture", subscriptionId: "sub_fixture", seq: 4 };
const session = { id: bound.checkoutId, object: "checkout.session", livemode: false, mode: "subscription", status: "complete", metadata: { kleeno_intent: intentId }, customer: bound.customerId, subscription: bound.subscriptionId };
const subscription = { id: bound.subscriptionId, object: "subscription", livemode: false, customer: bound.customerId, metadata: { kleeno_intent: intentId }, status: "past_due", cancel_at_period_end: true, pause_collection: { behavior: "void" }, latest_invoice: "in_fixture" };
const invoice = { id: "in_fixture", object: "invoice", livemode: false, customer: bound.customerId, status: "open", parent: { subscription_details: { subscription: bound.subscriptionId } } };
const fetchObjects = (...objects: unknown[]) => { const fetchFn = vi.fn(); for (const object of objects) fetchFn.mockResolvedValueOnce(new Response(JSON.stringify(object))); return fetchFn; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.seal.mockResolvedValue("encrypted-references");
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "claim_stripe_test_reconciliation" ? { code: "OK", state: bound } : { code: "OK", revision: 2 } }));
});
describe("Stripe TEST observed lifecycle", () => {
  it("records only current bound provider facts with lease/receipt fencing and no entitlement", async () => {
    const fetchFn = fetchObjects(session, subscription, invoice);
    await expect(reconcileStripeBilling(who, config, fetchFn)).resolves.toEqual({ revision: 2, entitlement: "UNCONFIGURED" });
    const claim = mocks.rpc.mock.calls.find(([name]) => name === "claim_stripe_test_reconciliation")![1];
    expect(mocks.rpc).toHaveBeenCalledWith("finish_stripe_test_reconciliation", expect.objectContaining({ p_company: companyId, p_actor: userId, p_token: claim.p_token, p_seq: 4, p_correlation: who.correlationId, p_observation: { intentId, checkoutId: bound.checkoutId, customerId: bound.customerId, subscriptionId: bound.subscriptionId, status: "past_due", cancelAtPeriodEnd: true, collectionPaused: true, invoiceId: "in_fixture", invoiceStatus: "open" } }));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["canceled", "void"], ["unpaid", "uncollectible"], ["active", "paid"],
  ])("observes %s/%s without software or payment authorization", async (status, invoiceStatus) => {
    await expect(reconcileStripeBilling(who, config, fetchObjects(session, { ...subscription, status }, { ...invoice, status: invoiceStatus }))).resolves.toMatchObject({ entitlement: "UNCONFIGURED" });
    expect(mocks.rpc.mock.calls.find(([name]) => name === "finish_stripe_test_reconciliation")![1].p_observation).toMatchObject({ status, invoiceStatus });
  });
  it("blocks removed owners before provider access", async () => {
    mocks.rpc.mockResolvedValue({ data: { code: "FORBIDDEN" }, error: null }); const fetchFn = vi.fn();
    await expect(reconcileStripeBilling(who, config, fetchFn)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each([
    ["customer mismatch", { ...invoice, customer: "cus_foreign" }],
    ["subscription mismatch", { ...invoice, parent: { subscription_details: { subscription: "sub_foreign" } } }],
    ["conflicting versioned references", { ...invoice, subscription: bound.subscriptionId, parent: { subscription_details: { subscription: "sub_foreign" } } }],
    ["live response", { ...invoice, livemode: true }],
  ])("preserves pending state on %s", async (_reason, wrongInvoice) => {
    await expect(reconcileStripeBilling(who, config, fetchObjects(session, subscription, wrongInvoice))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_stripe_test_reconciliation", "fail_stripe_test_reconciliation"]);
    const claim = mocks.rpc.mock.calls[0][1]; expect(mocks.rpc).toHaveBeenCalledWith("fail_stripe_test_reconciliation", { p_company: companyId, p_token: claim.p_token });
  });
  it.each(["CONFLICT", "FORBIDDEN"])("rejects %s after current-object reads instead of publishing stale state", async code => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "claim_stripe_test_reconciliation" ? { code: "OK", state: bound } : { code } }));
    await expect(reconcileStripeBilling(who, config, fetchObjects(session, subscription, invoice))).rejects.toMatchObject({ code });
    expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe("fail_stripe_test_reconciliation");
  });
  it("provider outage exposes no raw error or secret and releases its own lease", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("PRIVATE_PROVIDER_CANARY"));
    await expect(reconcileStripeBilling(who, config, fetchFn)).rejects.toMatchObject({ message: "Stripe TEST reconciliation failed; provider state remains pending" });
    expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe("fail_stripe_test_reconciliation");
  });
  it("unmatched signed hints cannot choose a company using metadata", async () => {
    const hint = { eventId: "evt_fixture", type: "invoice.paid", objectId: "in_fixture", objectType: "invoice" as const, customerId: "cus_foreign", subscriptionId: null };
    await recordStripeReceipt(hint, Buffer.from("fixture signed bytes"));
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_test_receipt", expect.objectContaining({ p_company: null, p_refs_enc: null, p_event: hint.eventId, p_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });
});

describe("failure and cancellation hints require a fresh observation", () => {
  it.each(["invoice.payment_failed", "customer.subscription.deleted"])("%s cannot erase current facts or grant an entitlement", async type => {
    const invoiceEvent = type.startsWith("invoice.");
    const hint = { eventId: "evt_failure", type, objectId: invoiceEvent ? "in_fixture" : bound.subscriptionId, objectType: invoiceEvent ? "invoice" as const : "subscription" as const, customerId: bound.customerId, subscriptionId: bound.subscriptionId };
    let state = { company_id: companyId, customer_id: bound.customerId, subscription_id: bound.subscriptionId, status: "active", invoice_status: "paid", cancel_at_period_end: false, collection_paused: false, observed_at: "2026-10-01T00:00:00Z", reconciliation_pending: false, revision: 1 };
    mocks.from.mockImplementation(() => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state, error: null }) }; return query; });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "record_stripe_test_receipt") { state.reconciliation_pending = true; return { error: null, data: { code: "OK", matched: true } }; }
      if (name === "claim_stripe_test_reconciliation") return { error: null, data: { code: "OK", state: bound } };
      const observation = args.p_observation as { status: string; invoiceStatus: string; cancelAtPeriodEnd: boolean; collectionPaused: boolean };
      state = { ...state, status: observation.status, invoice_status: observation.invoiceStatus, cancel_at_period_end: observation.cancelAtPeriodEnd, collection_paused: observation.collectionPaused, reconciliation_pending: false, revision: state.revision + 1 };
      return { error: null, data: { code: "OK", revision: state.revision } };
    });
    await recordStripeReceipt(hint, Buffer.from(JSON.stringify({ status: "canceled", amount_due: 999999, private: "FAILURE_HINT_CANARY" })));
    expect(await loadBillingProvider(companyId)).toMatchObject({ status: "active", invoiceStatus: "paid", reconciliation: "PENDING", entitlement: "UNCONFIGURED", collectionPolicy: "UNCONFIGURED" });
    const fetchFn = fetchObjects(session, { ...subscription, status: "past_due", cancel_at_period_end: false, pause_collection: null }, invoice);
    await reconcileStripeBilling(who, config, fetchFn);
    expect(await loadBillingProvider(companyId)).toMatchObject({ status: "past_due", invoiceStatus: "open", cancelAtPeriodEnd: false, collectionPaused: false, reconciliation: "CURRENT", entitlement: "UNCONFIGURED", collectionPolicy: "UNCONFIGURED" });
    await recordStripeReceipt({ ...hint, eventId: "evt_stale_failure" }, Buffer.from("old failed snapshot"));
    expect(await loadBillingProvider(companyId)).toMatchObject({ status: "past_due", invoiceStatus: "open", reconciliation: "PENDING" });
    const recovery = fetchObjects(session, { ...subscription, status: "active", cancel_at_period_end: true, pause_collection: null }, { ...invoice, status: "paid" });
    await reconcileStripeBilling(who, config, recovery);
    const summary = await loadBillingProvider(companyId);
    expect(summary).toMatchObject({ status: "active", invoiceStatus: "paid", cancelAtPeriodEnd: true, reconciliation: "CURRENT", entitlement: "UNCONFIGURED", collectionPolicy: "UNCONFIGURED" });
    expect(JSON.stringify(summary)).not.toContain("FAILURE_HINT_CANARY");
    expect([...fetchFn.mock.calls, ...recovery.mock.calls].every(([, options]) => options.method === undefined)).toBe(true);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["record_stripe_test_receipt", "claim_stripe_test_reconciliation", "finish_stripe_test_reconciliation", "record_stripe_test_receipt", "claim_stripe_test_reconciliation", "finish_stripe_test_reconciliation"]);
  });
});
