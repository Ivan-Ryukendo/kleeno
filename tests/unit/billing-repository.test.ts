import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), from: vi.fn(), seal: vi.fn(), open: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from, schema: () => ({ from: mocks.from }) }), must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data === null) throw new Error("database unavailable"); return r.data; } }));
vi.mock("@/server/db/growth", () => ({ isPlatformAdmin: mocks.admin }));
vi.mock("@/server/crypto", () => ({ sealJson: mocks.seal, fingerprint: mocks.fingerprint, openJson: mocks.open }));
import { billingAdminCommand, listBillingTiers, loadAdminBilling, loadOwnerBilling } from "@/server/db/billing";
const companyId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222";
const assignment = { action: "assign" as const, id: companyId, companyId, expectedRevision: 0, idempotencyKey: userId, reason: "PRIVATE_ENTERPRISE_TERMS", tierId: null, tierRevision: null, price: { name: "Enterprise", baseCents: 12500, workerCents: 0 }, usageEnabled: true };
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue(true); mocks.seal.mockResolvedValue("ciphertext"); mocks.fingerprint.mockResolvedValue("a".repeat(64)); mocks.rpc.mockResolvedValue({ data: { code: "OK", revision: 1 }, error: null }); });
describe("billing administration boundaries", () => {
  it("denies removed admins before encryption or RPC", async () => { mocks.admin.mockResolvedValue(false); await expect(billingAdminCommand({ userId }, assignment)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.seal).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("encrypts negotiated prices/reasons and binds command actor/company", async () => {
    await billingAdminCommand({ userId }, assignment);
    expect(mocks.fingerprint).toHaveBeenCalledWith(companyId, { actorId: userId, command: assignment });
    const call = mocks.rpc.mock.calls[0]; expect(call[0]).toBe("billing_company_command"); expect(call[1]).toMatchObject({ p_company: companyId, p_actor: userId, p_command: { payload_enc: "ciphertext" } });
    expect(mocks.seal).toHaveBeenCalledWith(companyId, "billing_company_events", "payload_enc", expect.any(String), { reason: assignment.reason, price: assignment.price });
  });
  it("propagates transactional stale/replay denial", async () => { mocks.rpc.mockResolvedValue({ data: { code: "CONFLICT" }, error: null }); await expect(billingAdminCommand({ userId }, assignment)).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("owner read rechecks stored OWNER role", async () => {
    const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: { roles: ["PAYROLL_APPROVER"] }, error: null }) }; mocks.from.mockReturnValue(q);
    await expect(loadOwnerBilling({ userId, companyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("memberships");
  });
  it("revocation during decryption blocks both owner and staff responses", async () => {
    let ownerAllowed = true;
    mocks.from.mockImplementation((table: string) => {
      const rows = table === "billing_company_events" ? [{ id: companyId, revision: 1, action: "assign", payload_enc: "ciphertext", created_at: "2026-10-08T00:00:00Z", usage_enabled: true }] : [];
      const q = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: { roles: ownerAllowed ? ["OWNER"] : [] }, error: null }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve) };
      return q;
    });
    mocks.open.mockImplementation(async () => { ownerAllowed = false; mocks.admin.mockResolvedValue(false); return { price: assignment.price }; });
    await expect(loadOwnerBilling({ userId, companyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.admin.mockResolvedValue(true);
    await expect(loadAdminBilling({ userId }, companyId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it("rechecks catalog access after its awaited read", async () => {
    const q = { select: () => q, order: () => q, limit: () => q, then: (resolve: (result: unknown) => unknown) => { mocks.admin.mockResolvedValue(false); return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve); } };
    mocks.from.mockReturnValue(q);
    await expect(listBillingTiers({ userId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
