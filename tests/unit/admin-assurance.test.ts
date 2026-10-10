import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ getUser: vi.fn(), assurance: vi.fn() }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/db/growth", () => ({ isPlatformAdmin: async () => true }));
vi.mock("@/server/auth/session", async (original) => ({
  ...(await original<typeof import("@/server/auth/session")>()),
  sessionClient: () => ({ auth: { getUser: calls.getUser, mfa: { getAuthenticatorAssuranceLevel: calls.assurance } } }),
}));
import { authenticateAdmin } from "@/server/auth/admin";
beforeEach(() => { vi.resetAllMocks(); calls.getUser.mockResolvedValue({ data: { user: { id: "admin" } }, error: null }); });

it.each([{}, { allowAal1: true }])("refuses stale password/aal2 data when the assurance lookup also failed (%j)", async (options) => {
  calls.assurance.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "password" }] }, error: { code: "session_refresh_failed" } });
  await expect(authenticateAdmin([], options)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
});
it("preserves verified password/MFA sessions and refuses OAuth-only admins", async () => {
  calls.assurance.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "password" }] }, error: null });
  await expect(authenticateAdmin([])).resolves.toMatchObject({ admin: { userId: "admin" } });
  calls.assurance.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "oauth" }] }, error: null });
  await expect(authenticateAdmin([])).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
});
