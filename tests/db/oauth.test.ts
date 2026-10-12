// P4g, S74: Google sign-in. The Google round trip itself cannot run here, so a session that did not start with a password is
// made with an email one-time link (amr "otp", like Google's "oauth": no `password`). Real handlers, real Supabase sessions.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { POST as startRoute } from "@/app/api/auth/oauth/google/route";
import { GET as callbackRoute } from "@/app/auth/callback/route";
import { authenticateAdmin } from "@/server/auth/admin";
import { completeCallback } from "@/server/auth/oauth";
import { callbackDeps } from "@/server/auth/oauth-session";
import { AuthError, authenticate, sessionClient, type PendingCookie } from "@/server/auth/session";
import { admin, call, makeCompany, totp, uniq } from "./helpers";

const growth = admin.schema("growth");
const savedMode = process.env.SITE_MODE;
const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  process.env.SITE_MODE = savedMode;
  for (const c of cleanup.reverse()) await c();
});

const jarOf = (sink: PendingCookie[]) => {
  const latest = new Map(sink.map((c) => [c.name, c.value]));
  return [...latest].filter(([, v]) => v).map(([name, value]) => ({ name, value }));
};

/** A session that did not start with a password. */
async function nonPasswordSession(email: string) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties.hashed_token) throw new Error("link failed");
  const sink: PendingCookie[] = [];
  const client = sessionClient([], sink);
  const { error } = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (error) throw new Error("otp sign-in failed");
  return { client, sink, jar: () => jarOf(sink) };
}

async function passwordSession(email: string, password: string) {
  const sink: PendingCookie[] = [];
  const client = sessionClient([], sink);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("sign-in failed");
  return { client, sink, jar: () => jarOf(sink) };
}

async function enrolTotp(client: ReturnType<typeof sessionClient>) {
  const enrol = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `t-${uniq()}` });
  if (enrol.error) throw new Error("enrol failed");
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
  if (verified.error) throw new Error("verify failed");
  return { factorId: enrol.data.id, secret: enrol.data.totp.secret };
}

const rejected = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as AuthError | null;

// What the callback does after the exchange, with the exchange itself answered by the session we already hold.
function callbackFor(session: { jar: () => { name: string; value: string }[] }, userId: string, sink: PendingCookie[], next: string | null = null) {
  const deps = callbackDeps(session.jar(), sink, randomUUID());
  return completeCallback({ ...deps, exchange: async () => userId }, { code: "fake-code", providerError: false, next, previousCompany: null });
}

describe("S74 the start and callback routes", () => {
  it("both are 404 in waitlist mode", async () => {
    process.env.SITE_MODE = "waitlist";
    expect((await call(startRoute, { body: {} })).status).toBe(404);
    expect((await call(callbackRoute, { method: "GET", origin: null, path: "/auth/callback?code=x" })).status).toBe(404);
  });

  it("start returns a PKCE Google authorize URL, keeps the code verifier in an httpOnly cookie, and only ever redirects to an allow-listed path", async () => {
    process.env.SITE_MODE = "app";
    const res = await call(startRoute, { body: { next: "//evil.example" } });
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).url);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("scopes")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("redirect_to")).toBe("http://localhost:3000/auth/callback"); // no query: matches the Supabase allow-list entry
    const next = res.headers.getSetCookie().find((c) => c.startsWith("kleeno-oauth-next="))!;
    expect(next).toMatch(/^kleeno-oauth-next=%2Fdashboard;|^kleeno-oauth-next=\/dashboard;/); // "//evil.example" was replaced by Home
    expect(next).toMatch(/HttpOnly/i);
    expect(next).toMatch(/SameSite=lax/i);
    expect(next).toMatch(/Max-Age=600/i);
    const good = await call(startRoute, { body: { next: "/workers" } });
    expect(good.headers.getSetCookie().find((c) => c.startsWith("kleeno-oauth-next="))).toMatch(/^kleeno-oauth-next=(%2F|\/)workers;/);
    const verifier = res.headers.getSetCookie().find((c) => c.includes("code-verifier"));
    expect(verifier).toMatch(/HttpOnly/i);
    expect(verifier).toMatch(/SameSite=lax/i);
  });

  it("start refuses unknown fields and a foreign Origin", async () => {
    process.env.SITE_MODE = "app";
    expect((await call(startRoute, { body: { next: "/workers", redirectTo: "https://evil.example" } })).status).toBe(400);
    expect((await call(startRoute, { body: {}, origin: "https://evil.example" })).status).toBe(403);
  });

  it("the callback clears the next cookie on every outcome and never takes the destination from the URL", async () => {
    process.env.SITE_MODE = "app";
    for (const q of ["", "?error=access_denied", "?code=not-a-real-code&next=https://evil.example"]) {
      const res = await call(callbackRoute, { method: "GET", origin: null, path: `/auth/callback${q}`, cookie: "kleeno-oauth-next=/workers" });
      const cleared = res.headers.getSetCookie().find((c) => c.startsWith("kleeno-oauth-next="));
      expect(cleared, q).toMatch(/^kleeno-oauth-next=;/);
      expect(cleared, q).toMatch(/Max-Age=0/i);
      expect(res.headers.get("location"), q).not.toContain("evil.example");
    }
  });

  it("a missing, denied or invalid code goes back to /login with the generic failure", async () => {
    process.env.SITE_MODE = "app";
    for (const q of ["", "?error=access_denied&error_description=x", "?code=not-a-real-code", "?code=not-a-real-code&next=//evil.example"]) {
      const res = await call(callbackRoute, { method: "GET", origin: null, path: `/auth/callback${q}` });
      expect(res.status, q).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search, q).toBe("/login?error=oauth");
      expect(res.headers.getSetCookie().some((c) => /auth-token=[^;]/.test(c) && !/auth-token(?:\.\d)?=;/.test(c)), q).toBe(false); // no session cookie
    }
  });
});

describe("S74 a session without a membership", () => {
  it("is signed out and refused; its cookies are cleared and the session is revoked", async () => {
    const email = `dbtest-oauth-${uniq()}@example.com`;
    const u = await admin.auth.admin.createUser({ email, email_confirm: true });
    cleanup.push(() => admin.auth.admin.deleteUser(u.data.user!.id));
    const s = await nonPasswordSession(email);
    expect((await s.client.auth.getUser()).data.user?.id).toBe(u.data.user!.id);
    const before = s.jar();

    const out: PendingCookie[] = [];
    const result = await callbackFor(s, u.data.user!.id, out, "/workers");
    expect(result).toEqual({ to: "/login?error=no-access", company: undefined });
    expect(jarOf(out).filter((c) => c.name.includes("auth-token"))).toEqual([]); // cleared
    expect((await sessionClient(before).auth.getUser()).error).not.toBeNull(); // revoked on the server
  });

  it("never gets in through the app guard either", async () => {
    const email = `dbtest-oauth-${uniq()}@example.com`;
    const u = await admin.auth.admin.createUser({ email, email_confirm: true });
    cleanup.push(() => admin.auth.admin.deleteUser(u.data.user!.id));
    const s = await nonPasswordSession(email);
    expect((await rejected(authenticate(s.jar())))?.code).toBe("NO_ACCESS");
  });
});

describe("S74 MFA still applies after a non-password sign-in (S43)", () => {
  it("an mfa_required company with no factor -> enrol first, and the session is refused until it is aal2", async () => {
    const c = await makeCompany({ mfa: true });
    const s = await nonPasswordSession(c.payroll.email);
    const result = await callbackFor(s, c.payroll.id, [], "/workers");
    expect(result).toEqual({ to: "/account", company: c.id });
    const err = await rejected(authenticate(s.jar()));
    expect(err).toMatchObject({ code: "MFA_REQUIRED", enrol: true });
  });

  it("a verified factor -> the MFA step; the page guard refuses aal1 and accepts the session only after the code", async () => {
    const c = await makeCompany({ mfa: true });
    const pw = await passwordSession(c.payroll.email, c.payroll.password);
    const { factorId, secret } = await enrolTotp(pw.client);

    const s = await nonPasswordSession(c.payroll.email);
    const result = await callbackFor(s, c.payroll.id, [], "/workers");
    expect(result.to).toBe(`/login?step=mfa&factor=${factorId}&next=%2Fworkers`);
    expect(await rejected(authenticate(s.jar()))).toMatchObject({ code: "MFA_REQUIRED", enrol: false });

    expect((await s.client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret, Date.now() + 30_000) })).error).toBeNull();
    const ok = await authenticate(s.jar());
    expect(ok.actor).toMatchObject({ userId: c.payroll.id, companyId: c.id, aal: "aal2" });
  });

  it("a company without the flag and a user without a factor goes straight to the destination", async () => {
    const c = await makeCompany();
    const s = await nonPasswordSession(c.payroll.email);
    expect(await callbackFor(s, c.payroll.id, [], "/workers")).toEqual({ to: "/workers", company: c.id });
    expect((await authenticate(s.jar())).actor.aal).toBe("aal1");
  });
});

describe("S74 the admin area needs a password session", () => {
  it("a platform admin signed in without a password is refused, even at aal2; the same admin with the password is accepted", async () => {
    const email = `dbtest-oauth-admin-${uniq()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const id = u.data.user!.id;
    expect((await growth.from("platform_admins").insert({ user_id: id })).error).toBeNull();
    cleanup.push(async () => {
      await growth.from("platform_admins").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    });

    const pw = await passwordSession(email, password);
    const { factorId, secret } = await enrolTotp(pw.client);
    expect((await authenticateAdmin(pw.jar())).admin.userId).toBe(id); // control: password + TOTP works

    const g = await nonPasswordSession(email);
    expect((await rejected(authenticateAdmin(g.jar(), { allowAal1: true })))?.code).toBe("FORBIDDEN"); // even for the MFA steps
    expect((await rejected(authenticateAdmin(g.jar())))?.code).toBe("FORBIDDEN");
    expect((await g.client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret, Date.now() + 30_000) })).error).toBeNull();
    expect((await rejected(authenticateAdmin(g.jar())))?.code).toBe("FORBIDDEN"); // aal2 does not make up for it
  });
});
