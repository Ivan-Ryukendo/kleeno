import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => mocks, must: (result: { data: unknown; error: unknown }) => {
  if (result.error || result.data === null) throw new Error("offline database unavailable");
  return result.data;
} }));
vi.mock("@/server/crypto", () => ({
  fingerprint: async (company: string, value: unknown) => createHash("sha256").update(JSON.stringify([company, value])).digest("hex"),
  sealJson: async (_company: string, _table: string, _field: string, _id: string, value: unknown) => JSON.stringify(value),
  openJson: async (_company: string, _table: string, _field: string, _id: string, value: string) => JSON.parse(value),
}));
import { collectStripeTest, loadBillingCollection, previewUsageInvoice, reconcileCollectionCommand } from "@/server/db/billing-collection";

const who = { companyId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", correlationId: "offline-usage" };
const key = "33333333-3333-4333-8333-333333333333", intentId = "44444444-4444-4444-8444-444444444444";
const config = { key: "sk_test_LOCAL_FIXTURE_ONLY", webhookSecret: "whsec_LOCAL_FIXTURE_ONLY", apiVersion: "2026-02-25.clover" };
const month = "2026-09-01", origin = "https://example.com";
type Row = Record<string, unknown>;
type Usage = { company_id: string; month: string; worker_id: string; assignment_id: string };

// Persist service hand-offs only: unique SIGNOFF metering, locking, and late-source CAS are tested against real SQL in tests/db/billing*.test.ts.
function fixture() {
  let command: Row | null = null, invoice: Row | null = null, item: Row | null = null;
  let lostStage: number | null = null, corrupt: ((value: Row) => Row) | null = null;
  const usage: Usage[] = [
    { company_id: who.companyId, month, worker_id: "W001", assignment_id: "original" },
    { company_id: who.companyId, month, worker_id: "W002", assignment_id: "enterprise" },
    { company_id: "foreign", month, worker_id: "W003", assignment_id: "original" },
    { company_id: who.companyId, month: "2026-10-01", worker_id: "W004", assignment_id: "original" },
  ];
  const assignments = [
    { id: "original", company_id: who.companyId, payload_enc: JSON.stringify({ price: { name: "Original", baseCents: 4900, workerCents: 200 } }) },
    { id: "enterprise", company_id: who.companyId, payload_enc: JSON.stringify({ price: { name: "Enterprise", baseCents: 9900, workerCents: 150 } }) },
    { id: "current", company_id: who.companyId, payload_enc: JSON.stringify({ price: { name: "New catalog price", baseCents: 12345, workerCents: 900 } }) },
  ];
  const requests: { method: string; url: string; body: URLSearchParams | null; key: string | null }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    const result = (single = false) => {
      let rows: Row[];
      if (table === "memberships") rows = [{ company_id: who.companyId, user_id: who.userId, roles: ["OWNER"] }];
      else if (table === "billing_provider_state") rows = [{ company_id: who.companyId, intent_id: intentId, customer_id: "cus_fixture", subscription_id: "sub_fixture" }];
      else if (table === "billing_company_events") rows = assignments;
      else if (table === "billing_worker_usage") rows = usage;
      else if (table === "billing_collection_commands") rows = command ? [command] : [];
      else throw new Error(`unexpected offline table ${table}`);
      rows = rows.filter(row => [...filters].every(([field, value]) => row[field] === value));
      return { data: structuredClone(single ? rows[0] ?? null : rows), count: rows.length, error: null };
    };
    const query = {
      select: () => query, eq: (field: string, value: unknown) => { filters.set(field, value); return query; },
      is: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => result(true), single: async () => result(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    const data: Row = { code: "OK" };
    if (name === "prepare_billing_collection") {
      command = { id: args.p_id, company_id: who.companyId, actor_id: who.userId, action: args.p_action, command_key: args.p_key, command_hash: args.p_hash, payload_enc: args.p_payload, usage_refs: args.p_usage, status: "READY", stage: 0, token: null, invoice_id: null, item_id: null, invoice_status: null };
      data.id = command.id;
    } else if (name === "claim_billing_collection") {
      if (command?.status !== "READY") data.code = "UNKNOWN";
      else { command.status = "IN_FLIGHT"; command.token = args.p_token; data.stage = command.stage; }
    } else if (name === "finish_billing_collection") {
      if (!command || command.token !== args.p_token || command.stage !== args.p_stage) throw new Error("invalid offline stage hand-off");
      const refs = args.p_refs as Row;
      command.invoice_id = refs.invoiceId ?? command.invoice_id; command.item_id = refs.itemId ?? command.item_id;
      command.invoice_status = refs.invoiceStatus ?? command.invoice_status;
      command.status = args.p_done ? "DONE" : "READY"; command.stage = Number(command.stage) + 1; command.token = null;
    } else if (name === "mark_billing_collection_unknown" && command) command.status = "UNKNOWN";
    else throw new Error(`unexpected offline RPC ${name}`);
    return { data, error: null };
  });
  const fetchFn = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input), method = options?.method ?? "GET", body = options?.body instanceof URLSearchParams ? options.body : null;
    requests.push({ method, url, body, key: new Headers(options?.headers).get("Idempotency-Key") });
    if (!command) throw new Error("provider called before preparation");
    let response: Row | null;
    if (method === "POST" && url.endsWith("/invoices")) {
      invoice = { id: "in_fixture", object: "invoice", livemode: false, customer: body?.get("customer"), subscription: body?.get("subscription"), currency: "usd", metadata: { kleeno_command: body?.get("metadata[kleeno_command]") }, status: "draft", total: 0, lines: { has_more: false, data: [] } };
      response = invoice;
    } else if (method === "POST" && url.endsWith("/invoiceitems") && invoice) {
      const amount = Number(body?.get("amount")), metadata = { kleeno_command: body?.get("metadata[kleeno_command]") };
      item = { id: "ii_fixture", object: "invoiceitem", livemode: false, customer: body?.get("customer"), invoice: body?.get("invoice"), currency: "usd", amount, metadata };
      invoice = { ...invoice, total: amount, lines: { has_more: false, data: [{ amount, metadata }] } }; response = item;
    } else if (method === "POST" && url.endsWith("/invoices/in_fixture/finalize") && invoice) {
      invoice = { ...invoice, status: "open" }; response = invoice;
    } else if (method === "GET" && url.endsWith("/invoices/in_fixture")) response = invoice;
    else if (method === "GET" && url.endsWith("/invoiceitems/ii_fixture")) response = item;
    else throw new Error(`unexpected offline provider request ${method} ${url}`);
    if (method === "POST" && lostStage === command.stage) { lostStage = null; throw new Error("offline lost reply after provider write"); }
    return Response.json(corrupt && response ? corrupt(structuredClone(response)) : response);
  });
  return { usage, fetchFn, requests, get command() { return command; }, lose(stage: number) { lostStage = stage; }, corrupt(fn: (value: Row) => Row) { corrupt = fn; } };
}
const reviewed = async () => { const quote = await previewUsageInvoice(who, month); return { action: "usage" as const, month, expectedAmountCents: quote.amountCents, expectedSourceHash: quote.sourceHash, idempotencyKey: key }; };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T00:00:00Z")); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden in offline usage acceptance"); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("fresh closed-month quote uses original per-worker assignment prices and yields one exact invoice; replay sends no writes", async () => {
  const f = fixture(), input = await reviewed();
  expect(input.expectedAmountCents).toBe(350);
  const result = await collectStripeTest(who, input, origin, config, f.fetchFn);
  expect(result).toMatchObject({ status: "DONE", invoiceId: "in_fixture", invoiceStatus: "open", entitlement: "UNCONFIGURED" });
  const payload = JSON.parse(String(f.command?.payload_enc));
  expect(payload).toMatchObject({ amountCents: 350, uniqueWorkers: 2, month, sourceHash: input.expectedSourceHash, customerId: "cus_fixture", subscriptionId: "sub_fixture" });
  expect(f.command?.usage_refs).toEqual([{ workerId: "W001", assignmentId: "original" }, { workerId: "W002", assignmentId: "enterprise" }]);
  const writes = f.requests.filter(r => r.method === "POST");
  expect(writes.map(r => r.key)).toEqual([`${result.id}:0`, `${result.id}:1`, `${result.id}:2`]);
  expect(writes[0].body?.get("pending_invoice_items_behavior")).toBe("exclude");
  expect(writes[0].body?.get("customer")).toBe("cus_fixture"); expect(writes[0].body?.get("subscription")).toBe("sub_fixture");
  expect(writes[1].body?.get("amount")).toBe("350"); expect(writes[1].body?.get("invoice")).toBe("in_fixture");
  expect(writes[1].body?.get("description")).toBe("Reviewed-worker usage 2026-09 UTC (2 unique workers)");
  expect(writes[1].body?.get("metadata[kleeno_command]")).toBe(result.id);
  expect(writes[1].body?.toString()).not.toMatch(/W001|W002|original|enterprise/);
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).resolves.toMatchObject({ id: result.id, status: "DONE" });
  expect(f.requests).toHaveLength(5); expect(mocks.rpc.mock.calls.filter(([name]) => name === "prepare_billing_collection")).toHaveLength(1);
  await expect(loadBillingCollection(who.companyId, async () => {})).resolves.toEqual([expect.objectContaining({ amountCents: 350, uniqueWorkers: 2, sourceHash: input.expectedSourceHash, usageReconciliation: "MATCHED" })]);
});

it("new late usage invalidates a reviewed quote before preparation, then flags a completed invoice without replacement collection", async () => {
  const f = fixture(), input = await reviewed();
  f.usage.push({ company_id: who.companyId, month, worker_id: "W005", assignment_id: "original" });
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  const refreshed = await reviewed(); await collectStripeTest(who, refreshed, origin, config, f.fetchFn);
  f.usage.push({ company_id: who.companyId, month, worker_id: "W006", assignment_id: "enterprise" });
  await expect(loadBillingCollection(who.companyId, async () => {})).resolves.toEqual([expect.objectContaining({ amountCents: 550, usageReconciliation: "UNRECONCILED_LATE_USAGE" })]);
  await collectStripeTest(who, refreshed, origin, config, f.fetchFn);
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(3);
});

it("zero closed-month usage records NO_CHARGE without Stripe; the current UTC month cannot be collected", async () => {
  const f = fixture(); f.usage.length = 0;
  await expect(collectStripeTest(who, await reviewed(), origin, config, f.fetchFn)).resolves.toMatchObject({ status: "DONE", invoiceId: null, invoiceStatus: "NO_CHARGE", entitlement: "UNCONFIGURED" });
  expect(f.requests).toHaveLength(0);
  await expect(collectStripeTest(who, { ...await reviewed(), month: "2026-10-01", idempotencyKey: intentId }, origin, config, f.fetchFn)).rejects.toThrow("Only a closed UTC month can be invoiced");
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "prepare_billing_collection")).toHaveLength(1);
});

for (const stage of [0, 1, 2]) it(`lost successful stage ${stage} stays UNKNOWN until exact-object read recovery; earlier stages never repeat`, async () => {
  const f = fixture(), input = await reviewed(); f.lose(stage);
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.command).toMatchObject({ status: "UNKNOWN", stage });
  const before = f.requests.length;
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.requests).toHaveLength(before);
  await expect(reconcileCollectionCommand(who, String(f.command?.id), stage === 1 ? "ii_fixture" : "in_fixture", config, f.fetchFn)).resolves.toMatchObject({ status: stage === 2 ? "DONE" : "READY", entitlement: "UNCONFIGURED" });
  expect(f.requests.at(-1)?.method).toBe("GET");
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).resolves.toMatchObject({ status: "DONE", invoiceStatus: "open" });
  expect(f.requests.filter(r => r.method === "POST").map(r => r.key)).toEqual([0, 1, 2].map(s => `${f.command?.id}:${s}`));
});

for (const field of ["customer", "subscription", "command", "line"] as const) it(`foreign ${field} binding cannot be recovered even with matching invoice amount`, async () => {
  const f = fixture(), input = await reviewed(); f.lose(2);
  await expect(collectStripeTest(who, input, origin, config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  f.corrupt(value => field === "line" ? { ...value, lines: { has_more: false, data: [{ amount: 350, metadata: { kleeno_command: intentId } }] } } : field === "command" ? { ...value, metadata: { kleeno_command: intentId } } : { ...value, [field]: `${field === "customer" ? "cus" : "sub"}_foreign` });
  const finishes = mocks.rpc.mock.calls.filter(([name]) => name === "finish_billing_collection").length;
  await expect(reconcileCollectionCommand(who, String(f.command?.id), "in_fixture", config, f.fetchFn)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.command).toMatchObject({ status: "UNKNOWN", stage: 2 });
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "finish_billing_collection")).toHaveLength(finishes);
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(3);
});