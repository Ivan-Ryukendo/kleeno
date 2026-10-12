import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc }), must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("database unavailable"); return r.data; } }));
import { loadPlatformAccounts } from "@/server/db/platform-accounts";

const inventory = {
  scope: "CURRENT_DATABASE_INVENTORY", asOf: "2026-10-07T00:00:00Z",
  accounts: { registered: 1, withActiveMembership: 0, onlyDemoSandboxMemberships: 0, unmarkedMemberships: 0, withoutActiveMembership: 1, testClassification: "UNKNOWN" },
  companies: { total: 0, demo: 0, sandbox: 0, demoOrSandbox: 0, unmarked: 0, testClassification: "UNKNOWN" },
  memberships: { total: 0, active: 0, removed: 0 }, workers: { total: 0, inDemoOrSandboxCompanies: 0, inUnmarkedCompanies: 0 },
  invitations: { total: 0, pending: 0, expired: 0, used: 0, revoked: 0 }, leads: { total: 0, markedTest: 0, unmarked: 0 },
  commercial: { paidCompanies: null, trials: null, subscriptions: null, activatedReviewers: null, testExclusionsComplete: false },
};
beforeEach(() => vi.resetAllMocks());

it("requests one atomic count snapshot bound to the authenticated platform actor", async () => {
  rpc.mockResolvedValue({ data: inventory, error: null });
  expect(await loadPlatformAccounts({ userId: "admin" })).toEqual(inventory);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_account_inventory", { p_actor: "admin" });
});
it("fails closed after platform access revocation or DB failure", async () => {
  rpc.mockResolvedValue({ data: { code: "FORBIDDEN" }, error: null });
  await expect(loadPlatformAccounts({ userId: "removed" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  rpc.mockResolvedValue({ data: null, error: { message: "private driver values" } });
  await expect(loadPlatformAccounts({ userId: "admin" })).rejects.toThrow("database unavailable");
});
it("rejects contradictory totals and any private fields instead of publishing them", async () => {
  for (const data of [{ ...inventory, privateEmails: ["private@example.com"] }, { ...inventory, accounts: { ...inventory.accounts, registered: 2 } }]) {
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadPlatformAccounts({ userId: "admin" })).rejects.toThrow();
  }
});
