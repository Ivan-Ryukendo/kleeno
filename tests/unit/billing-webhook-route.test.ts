import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/server/site", () => ({ siteMode: () => "app", adminGateOk: () => false }));
vi.mock("@/server/auth/admin", () => ({ authenticateAdmin: mocks.authenticate }));
vi.mock("@/server/auth/session", () => ({
  AuthError: class extends Error {}, jarFromRequest: () => ({}),
  authenticate: mocks.authenticate, authenticateUser: mocks.authenticate,
}));
vi.mock("@/server/db/client", () => ({ db: () => mocks, must: (result: { data: unknown; error: unknown }) => {
  if (result.error || result.data === null) throw new Error("fixture database unavailable");
  return result.data;
} }));
vi.mock("@/server/crypto", () => ({ sealJson: async () => "encrypted-fixture-references" }));
import { POST } from "@/app/api/stripe/webhook/route";

const secret = "whsec_LOCAL_FIXTURE_ONLY";
const event = { id: "evt_fixture", object: "event", livemode: false, type: "customer.subscription.updated", created: 1,
  data: { object: { id: "sub_fixture", object: "subscription", livemode: false, customer: "cus_fixture", status: "active", metadata: { companyId: "untrusted-company", payroll: "PRIVATE_CANARY" } } } };
const bytes = (value: unknown = event) => Buffer.from(JSON.stringify(value));
function request(raw = bytes(), timestamp = Math.floor(Date.now() / 1000), signedBytes = raw) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(signedBytes).digest("hex");
  return new Request("https://example.com/api/stripe/webhook", { method: "POST", body: raw,
    headers: { "stripe-signature": `t=${timestamp},v1=${digest}` } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_LOCAL_FIXTURE_ONLY");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_API_VERSION", "2026-02-25.clover");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected provider access")));
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  mocks.from.mockReturnValue(query);
  mocks.rpc.mockResolvedValue({ data: { code: "OK", duplicate: false, matched: false }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("accepts signed exact bytes through the real public wrapper and stores only projected hints", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, duplicate: false, matched: false });
  expect(response.headers.get("x-correlation-id")).toBeTruthy();
  expect(mocks.authenticate).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_test_receipt", expect.objectContaining({
    p_company: null, p_event: "evt_fixture", p_type: event.type, p_object: "sub_fixture", p_refs_enc: null,
    p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("PRIVATE_CANARY");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects forged, changed and expired signatures before any database access", async () => {
  for (const req of [request(bytes(), Math.floor(Date.now() / 1000), Buffer.from("forged")),
    request(Buffer.concat([bytes(), Buffer.from(" ")]), Math.floor(Date.now() / 1000), bytes()),
    request(bytes(), Math.floor(Date.now() / 1000) - 301)]) {
    expect((await POST(req)).status).toBe(401);
  }
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("rejects signed LIVE, Connect and malformed events before storage", async () => {
  for (const body of [{ ...event, livemode: true }, { ...event, account: "acct_foreign" }, { ...event, data: {} }]) {
    expect((await POST(request(bytes(body)))).status).toBe(400);
  }
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("bounds streamed bytes and refuses missing TEST configuration before storage", async () => {
  expect((await POST(request(Buffer.alloc(256 * 1024 + 1)))).status).toBe(413);
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "");
  expect((await POST(request())).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("returns durable duplicate/conflict outcomes instead of provider or payment actions", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { code: "OK", duplicate: true }, error: null });
  expect(await (await POST(request())).json()).toEqual({ ok: true, duplicate: true, matched: false });
  mocks.rpc.mockResolvedValueOnce({ data: { code: "CONFLICT" }, error: null });
  expect((await POST(request())).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
