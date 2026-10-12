import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), signIn: vi.fn(), factors: vi.fn(), assurance: vi.fn(), enroll: vi.fn(), verify: vi.fn(), throttle: vi.fn(), audit: vi.fn() }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/db/client", () => ({ db: () => calls }));
// These tests exercise handler decisions; the mocked guard does not verify schema, Origin or session enforcement.
vi.mock("@/server/auth/guard", () => ({ openRoute: (_opts: unknown, handler: unknown) => handler, guarded: (_opts: unknown, handler: unknown) => handler }));
vi.mock("@/server/auth/login", () => ({ assertNotThrottled: calls.throttle, recordAuthEvent: calls.audit }));
vi.mock("@/server/auth/company", () => ({ COMPANY_COOKIE: "kleeno-company", readCompany: () => null, companyCookie: (value: string) => ({ name: "kleeno-company", value }), clearCompanyCookie: () => ({ name: "kleeno-company", value: "" }) }));
vi.mock("@/server/auth/session", async (original) => ({
  ...(await original<typeof import("@/server/auth/session")>()),
  sessionClient: () => ({ auth: { signInWithPassword: calls.signIn, mfa: { listFactors: calls.factors } } }),
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as enroll } from "@/app/api/auth/mfa/enroll/route";
import { POST as verify } from "@/app/api/auth/mfa/verify/route";
import { AuthError, type PendingCookie } from "@/server/auth/session";

const actor = { companyId: "company", userId: "user" };
const correlationId = "correlation";
const client = { auth: { mfa: { getAuthenticatorAssuranceLevel: calls.assurance, enroll: calls.enroll, challengeAndVerify: calls.verify } } };
const membership = (mfa = false) => ({ user_id: "user", company_id: "company", companies: { mfa_required: mfa } });
const loginInput = (cookies: PendingCookie[] = []) => ({ body: { email: "OWNER@example.com", password: "synthetic-password" }, jar: [], cookies, correlationId });
const verifyInput = () => ({ actor, client, body: { factorId: "factor", code: "123456" }, correlationId });

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [calls.from, calls.select, calls.eq, calls.is]) method.mockReturnValue(calls);
  calls.order.mockResolvedValue({ data: [membership()], error: null });
  calls.signIn.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  calls.factors.mockResolvedValue({ data: { totp: [] }, error: null });
  calls.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  calls.enroll.mockResolvedValue({ data: { id: "factor", totp: { qr_code: "synthetic-qr", secret: "synthetic-secret" } }, error: null });
  calls.verify.mockResolvedValue({ error: null });
});

describe("password login decisions", () => {
  it.each([false, true])("routes an account without a factor with mfa_required=%s", async (required) => {
    calls.order.mockResolvedValue({ data: [membership(required)], error: null });
    const input = loginInput();
    await expect(login(input as never)).resolves.toEqual({ next: required ? "enrol" : "dashboard" });
    expect(calls.signIn).toHaveBeenCalledWith({ email: "owner@example.com", password: "synthetic-password" });
    expect(input.cookies).toEqual([{ name: "kleeno-company", value: "company" }]);
    expect(calls.audit).toHaveBeenCalledWith("LOGIN_OK", "company", "user", correlationId);
  });

  it("routes an existing verified factor to MFA even when the company does not require it", async () => {
    calls.factors.mockResolvedValue({ data: { totp: [{ id: "factor", status: "verified" }] }, error: null });
    await expect(login(loginInput() as never)).resolves.toEqual({ next: "mfa", factorId: "factor" });
  });

  it.each(["missing", "mismatched"])("refuses %s membership and discards cookies", async (kind) => {
    calls.order.mockResolvedValue({ data: kind === "missing" ? [] : [{ ...membership(), user_id: "someone-else" }], error: null });
    const cookies: PendingCookie[] = [{ name: "synthetic-session", value: "synthetic-value", options: {} }];
    await expect(login(loginInput(cookies) as never)).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
    expect(cookies).toHaveLength(0);
    expect(calls.audit).not.toHaveBeenCalled();
    expect(calls.factors).not.toHaveBeenCalled();
  });

  it("audits a failed password and never inspects factors", async () => {
    calls.signIn.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
    await expect(login(loginInput() as never)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(calls.throttle).toHaveBeenCalledWith("company", "user", "LOGIN_FAILED");
    expect(calls.audit).toHaveBeenCalledExactlyOnceWith("LOGIN_FAILED", "company", "user", correlationId);
    expect(calls.factors).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { code: "session_refresh_failed" } },
    { data: null, error: null },
  ])("fails closed when the factor lookup fails instead of returning dashboard", async (result) => {
    calls.factors.mockResolvedValue(result);
    await expect(login(loginInput() as never)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });
});

describe("MFA enrolment decisions", () => {
  it("refuses a password-only session with an existing verified factor", async () => {
    calls.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    await expect(enroll({ client } as never)).rejects.toMatchObject({ status: 401, code: "MFA_REQUIRED" });
    expect(calls.enroll).not.toHaveBeenCalled();
  });

  it.each(["aal1", "aal2"])("allows enrolment after an explicit %s assurance without an unmet second step", async (currentLevel) => {
    calls.assurance.mockResolvedValue({ data: { currentLevel, nextLevel: currentLevel }, error: null });
    await expect(enroll({ client } as never)).resolves.toEqual({ factorId: "factor", qr: "synthetic-qr", secret: "synthetic-secret" });
    expect(calls.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: expect.stringMatching(/^kleeno-/) });
  });
});

describe("MFA verification decisions", () => {
  it("verifies the requested factor and audits success", async () => {
    await expect(verify(verifyInput() as never)).resolves.toEqual({ ok: true });
    expect(calls.throttle).toHaveBeenCalledWith("company", "user", "MFA_FAILED");
    expect(calls.verify).toHaveBeenCalledWith({ factorId: "factor", code: "123456" });
    expect(calls.audit).toHaveBeenCalledExactlyOnceWith("MFA_OK", "company", "user", correlationId);
  });

  it("audits a rejected code without recording success", async () => {
    calls.verify.mockResolvedValue({ error: { code: "mfa_verification_failed" } });
    await expect(verify(verifyInput() as never)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(calls.audit).toHaveBeenCalledExactlyOnceWith("MFA_FAILED", "company", "user", correlationId);
  });

  it("stops before provider verification and auditing when throttled", async () => {
    calls.throttle.mockRejectedValue(new AuthError(429, "THROTTLED", "Too many attempts"));
    await expect(verify(verifyInput() as never)).rejects.toMatchObject({ status: 429, code: "THROTTLED" });
    expect(calls.verify).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });
});
