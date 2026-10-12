import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ authenticate: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), unlink: vi.fn(), reauth: vi.fn(), audit: vi.fn() }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/auth/session", async (original) => ({
  ...(await original<typeof import("@/server/auth/session")>()),
  authenticate: calls.authenticate,
}));
vi.mock("@/server/auth/login", () => ({ requireReauth: calls.reauth, recordAuthEvent: calls.audit }));
import { AuthError } from "@/server/auth/session";
import { POST as logoutOthers } from "@/app/api/auth/logout-others/route";
import { POST as unlinkGoogle } from "@/app/api/auth/oauth/google/unlink/route";

const actor = { companyId: "company", userId: "user", email: "old@example.invalid", roles: ["OWNER"], aal: "aal2", mfaRequired: true };
const google = { id: "google-id", identity_id: "google-identity", user_id: "user", provider: "google" };
const email = { id: "email-id", identity_id: "email-identity", user_id: "user", provider: "email" };
const user = { id: "user", email: "current@example.invalid", identities: [google, email] };
const client = { auth: { getUser: calls.getUser, signOut: calls.signOut, unlinkIdentity: calls.unlink } };
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/auth/account-action", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SITE_MODE", "app");
  calls.authenticate.mockResolvedValue({ actor, client });
  calls.getUser.mockResolvedValue({ data: { user }, error: null });
  calls.signOut.mockResolvedValue({ error: null });
  calls.unlink.mockResolvedValue({ error: null });
});

describe("sign out other sessions", () => {
  it("uses only the native others scope and keeps current cookies", async () => {
    const response = await logoutOthers(request({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "others" });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(calls.audit).toHaveBeenCalledWith("OTHER_SESSIONS_SIGNED_OUT", "company", "user", expect.any(String));
  });

  it("sanitizes a provider refusal and does not claim success", async () => {
    calls.signOut.mockResolvedValue({ error: { message: "private token details" } });
    const response = await logoutOthers(request({}));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private token");
    expect(calls.audit).not.toHaveBeenCalled();
  });
});

describe("unlink Google", () => {
  it("revalidates identity and password before unlinking the server-selected Google method", async () => {
    const response = await unlinkGoogle(request({ password: "synthetic-password" }));
    expect(response.status).toBe(200);
    expect(calls.getUser).toHaveBeenCalledOnce();
    expect(calls.reauth).toHaveBeenCalledWith({ ...actor, email: user.email }, "synthetic-password", expect.any(String));
    expect(calls.unlink).toHaveBeenCalledExactlyOnceWith(google);
    expect(calls.reauth.mock.invocationCallOrder[0]).toBeLessThan(calls.unlink.mock.invocationCallOrder[0]);
    expect(calls.audit).toHaveBeenCalledWith("GOOGLE_UNLINKED", "company", "user", expect.any(String));
    expect(JSON.stringify(calls.audit.mock.calls)).not.toContain("synthetic-password");
  });

  it.each([
    { ...user, identities: [google] },
    { ...user, identities: [google, { ...email, provider: "github" }] },
    { ...user, email: undefined },
    { ...user, identities: undefined },
  ])("blocks unlink when no email/password alternative can be proved", async (unsafeUser) => {
    calls.getUser.mockResolvedValue({ data: { user: unsafeUser }, error: null });
    expect((await unlinkGoogle(request({ password: "synthetic-password" }))).status).toBe(403);
    expect(calls.reauth).not.toHaveBeenCalled();
    expect(calls.unlink).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { ...user, id: "another-user" } }, error: null },
    { data: { user }, error: { message: "private token" } },
  ])("fails closed on invalid fresh identity", async (result) => {
    calls.getUser.mockResolvedValue(result);
    expect((await unlinkGoogle(request({ password: "synthetic-password" }))).status).toBe(401);
    expect(calls.reauth).not.toHaveBeenCalled();
    expect(calls.unlink).not.toHaveBeenCalled();
  });

  it("refuses an account with no Google identity", async () => {
    calls.getUser.mockResolvedValue({ data: { user: { ...user, identities: [email] } }, error: null });
    expect((await unlinkGoogle(request({ password: "synthetic-password" }))).status).toBe(403);
    expect(calls.unlink).not.toHaveBeenCalled();
  });

  it.each([401, 429] as const)("propagates reauth status %s before any unlink", async (status) => {
    calls.reauth.mockRejectedValue(new AuthError(status, status === 429 ? "THROTTLED" : "UNAUTHENTICATED", "confirmation refused"));
    expect((await unlinkGoogle(request({ password: "wrong" }))).status).toBe(status);
    expect(calls.unlink).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it("reports unsupported native unlink without leaking provider details or auditing success", async () => {
    calls.unlink.mockResolvedValue({ error: { message: "private provider configuration details" } });
    const response = await unlinkGoogle(request({ password: "synthetic-password" }));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private provider");
    expect(calls.audit).not.toHaveBeenCalled();
  });
});

describe.each([["logout others", logoutOthers, {}], ["unlink Google", unlinkGoogle, { password: "synthetic-password" }]] as const)("%s guard", (_name, handler, body) => {
  it("rejects cross-origin calls before authentication", async () => {
    expect((await handler(request(body, "https://attacker.invalid"))).status).toBe(403);
    expect(calls.authenticate).not.toHaveBeenCalled();
    expect(calls.signOut).not.toHaveBeenCalled();
    expect(calls.unlink).not.toHaveBeenCalled();
  });

  it.each(["UNAUTHENTICATED", "MFA_REQUIRED"] as const)("preserves %s rejection", async (code) => {
    calls.authenticate.mockRejectedValue(new AuthError(401, code, "sign in required"));
    expect((await handler(request(body))).status).toBe(401);
    expect(calls.signOut).not.toHaveBeenCalled();
    expect(calls.unlink).not.toHaveBeenCalled();
  });

  it("rejects caller-selected identity, company or sign-out scope", async () => {
    expect((await handler(request({ ...body, identityId: "arbitrary", companyId: "other", scope: "global" }))).status).toBe(400);
    expect(calls.signOut).not.toHaveBeenCalled();
    expect(calls.unlink).not.toHaveBeenCalled();
  });
});
