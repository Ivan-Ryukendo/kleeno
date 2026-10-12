import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), getUser: vi.fn(), assurance: vi.fn(), enroll: vi.fn() }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/auth/company", () => ({ COMPANY_COOKIE: "kleeno-company", COMPANY_HEADER: "x-kleeno-company", readCompany: () => null }));
vi.mock("@/server/db/client", () => ({ db: () => calls }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: calls.getUser, mfa: { getAuthenticatorAssuranceLevel: calls.assurance } } }) }));
vi.mock("@/server/auth/guard", () => ({ guarded: (_opts: unknown, handler: unknown) => handler }));
import { authenticate, authenticateUser } from "@/server/auth/session";
import { POST as enroll } from "@/app/api/auth/mfa/enroll/route";

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [calls.from, calls.select, calls.eq, calls.is]) method.mockReturnValue(calls);
  calls.order.mockReturnValue(calls);
  calls.order.mockReturnValueOnce(calls).mockResolvedValueOnce({ data: [{ company_id: "company", roles: ["OWNER"], email: "owner@example.com", companies: { name: "Synthetic", mfa_required: false } }] });
  calls.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
});

it.each([["company", authenticate], ["chooser", authenticateUser]] as const)("%s refuses an unknown assurance level after identity succeeds", async (_name, auth) => {
  calls.assurance.mockResolvedValue({ data: null, error: { code: "session_refresh_failed" } });
  await expect(auth([])).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
});

it.each([["company", authenticate], ["chooser", authenticateUser]] as const)("%s refuses a missing session even when the SDK supplies no error", async (_name, auth) => {
  calls.assurance.mockResolvedValue({ data: { currentLevel: null, nextLevel: null }, error: null });
  await expect(auth([])).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
});

it.each([["company", authenticate], ["chooser", authenticateUser]] as const)("%s preserves an explicit aal1 session without MFA", async (_name, auth) => {
  calls.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  await expect(auth([])).resolves.toMatchObject({});
});

it("does not enroll a new device when the existing-factor assurance check fails", async () => {
  calls.assurance.mockResolvedValue({ data: null, error: { code: "session_refresh_failed" } });
  calls.enroll.mockResolvedValue({ data: { id: "factor", totp: { qr_code: "qr", secret: "secret" } }, error: null });
  const client = { auth: { mfa: { getAuthenticatorAssuranceLevel: calls.assurance, enroll: calls.enroll } } };
  await expect(enroll({ client } as never)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(calls.enroll).not.toHaveBeenCalled();
});
