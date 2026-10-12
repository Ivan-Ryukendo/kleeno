import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ options: [] as { roles?: string[]; body?: { safeParse: (value: unknown) => { success: boolean } } }[], reauth: vi.fn(), collect: vi.fn(), reconcile: vi.fn(), preview: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ guarded: (options: unknown, handler: unknown) => { mocks.options.push(options as never); return handler; } }));
vi.mock("@/server/auth/login", () => ({ requireReauth: mocks.reauth }));
vi.mock("@/server/db/billing-collection", () => ({ collectStripeTest: mocks.collect, reconcileCollectionCommand: mocks.reconcile, previewUsageInvoice: mocks.preview }));
vi.mock("@/server/env", () => ({ env: { SITE_URL: "https://example.com" } }));
import { POST as collect } from "@/app/api/billing/collect/route";
import { POST as reconcile } from "@/app/api/billing/commands/reconcile/route";
import { GET as preview } from "@/app/api/billing/usage/route";
const actor = { companyId: "company", userId: "owner", email: "fixture@example.com" }, correlationId = "request";
beforeEach(() => { vi.clearAllMocks(); mocks.reauth.mockResolvedValue(undefined); mocks.preview.mockResolvedValue({ month: "2026-09-01", amountCents: 200, uniqueWorkers: 1, sourceHash: "a".repeat(64) }); });
it("collection checks current password before any write service and derives company/actor from session", async () => {
  const body = { command: { action: "checkout", expectedBaseCents: 4900, idempotencyKey: "11111111-1111-4111-8111-111111111111" }, password: "LOCAL_FIXTURE_ONLY" };
  const call = collect as unknown as (value: unknown) => Promise<unknown>;
  mocks.reauth.mockRejectedValueOnce(new Error("password denied"));
  await expect(call({ actor, body, correlationId })).rejects.toThrow("password denied"); expect(mocks.collect).not.toHaveBeenCalled();
  await call({ actor, body, correlationId });
  expect(mocks.collect).toHaveBeenCalledWith({ companyId: actor.companyId, userId: actor.userId, correlationId }, body.command, "https://example.com");
  expect(mocks.collect.mock.calls[0]).not.toContain(body.password);
  expect(mocks.options.every(option => JSON.stringify(option.roles) === '["OWNER"]')).toBe(true);
  expect(mocks.options[0].body!.safeParse({ ...body, companyId: "foreign" }).success).toBe(false);
});
it("usage preview and explicit reconciliation are scoped read paths with no collection or credential replay", async () => {
  await (preview as unknown as (value: unknown) => Promise<unknown>)({ actor, request: new Request("https://example.com/api/billing/usage?month=2026-09-01"), correlationId });
  await (reconcile as unknown as (value: unknown) => Promise<unknown>)({ actor, body: { commandId: "command", objectId: "in_fixture" }, correlationId });
  expect(mocks.preview).toHaveBeenCalledWith({ companyId: actor.companyId, userId: actor.userId, correlationId }, "2026-09-01");
  expect(mocks.reconcile).toHaveBeenCalledWith({ companyId: actor.companyId, userId: actor.userId, correlationId }, "command", "in_fixture");
  expect(mocks.reauth).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled();
});
