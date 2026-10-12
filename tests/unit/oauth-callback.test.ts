// S74: the callback checks in order, with fake ports (no Supabase, no Google).
import { describe, expect, it } from "vitest";
import { completeCallback, type CallbackDeps } from "@/server/auth/oauth";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const FACTOR = "33333333-3333-4333-8333-333333333333";

type Over = Partial<CallbackDeps> & { userId?: string | null; rows?: { companyId: string; mfaRequired: boolean }[]; factor?: string | null };

function fake(over: Over = {}) {
  const { userId, rows, factor, ...ports } = over;
  const calls: string[] = [];
  const logs: Record<string, string | number | boolean>[] = [];
  const deps: CallbackDeps = {
    exchange: async () => (calls.push("exchange"), userId === undefined ? "user-1" : userId),
    memberships: async () => (calls.push("memberships"), rows ?? [{ companyId: C1, mfaRequired: false }]),
    verifiedFactor: async () => (calls.push("factor"), factor ?? null),
    signOut: async () => void calls.push("signOut"),
    audit: async (event, companyId) => void calls.push(`audit:${event}:${companyId}`),
    log: (event, refs) => void (calls.push(`log:${event}`), logs.push(refs)),
    ...ports,
  };
  return { deps, calls, logs };
}
const input = (o: Partial<Parameters<typeof completeCallback>[1]> = {}) => ({ code: "abc", providerError: false, next: null, previousCompany: null, ...o });

describe("callback error paths -> /login?error=oauth", () => {
  it("no code, or an error from the provider (user denied, sign-up refused): nothing is exchanged", async () => {
    for (const i of [input({ code: null }), input({ code: "" }), input({ providerError: true })]) {
      const t = fake();
      expect(await completeCallback(t.deps, i)).toEqual({ to: "/login?error=oauth", company: undefined });
      expect(t.calls).toEqual(["log:oauth.failed"]);
    }
  });
  it("a failed, expired or reused code (exchange gives no user)", async () => {
    const t = fake({ userId: null });
    expect(await completeCallback(t.deps, input())).toEqual({ to: "/login?error=oauth", company: undefined });
    expect(t.calls).toEqual(["exchange", "log:oauth.failed"]);
  });
  it("an exchange that throws is the same refusal", async () => {
    const t = fake({
      exchange: async () => {
        throw new Error("boom");
      },
    });
    expect((await completeCallback(t.deps, input())).to).toBe("/login?error=oauth");
  });
});

describe("no membership", () => {
  it("is signed out and refused with the calm message; never audited against a company", async () => {
    const t = fake({ rows: [] });
    expect(await completeCallback(t.deps, input({ next: "/workers" }))).toEqual({ to: "/login?error=no-access", company: undefined });
    expect(t.calls).toEqual(["exchange", "memberships", "signOut", "log:oauth.failed"]);
  });
  it("is refused even when sign-out fails", async () => {
    const t = fake({
      rows: [],
      signOut: async () => {
        throw new Error("down");
      },
    });
    expect((await completeCallback(t.deps, input())).to).toBe("/login?error=no-access");
  });
});

describe("success and MFA", () => {
  it("one company: audited, active company set, allow-listed destination", async () => {
    const t = fake();
    expect(await completeCallback(t.deps, input({ next: "/workers" }))).toEqual({ to: "/workers", company: C1 });
    expect(t.calls).toContain(`audit:OAUTH_LOGIN_OK:${C1}`);
  });
  it("a hostile next falls back Home", async () => {
    const t = fake();
    expect((await completeCallback(t.deps, input({ next: "//evil.example" }))).to).toBe("/dashboard");
  });
  it("a verified factor -> the MFA step first (the session stays aal1 until the code is verified)", async () => {
    const t = fake({ factor: FACTOR });
    expect(await completeCallback(t.deps, input({ next: "/workers" }))).toEqual({ to: `/login?step=mfa&factor=${FACTOR}&next=%2Fworkers`, company: C1 });
  });
  it("an mfa_required company with no factor yet -> enrol on /account", async () => {
    const t = fake({ rows: [{ companyId: C1, mfaRequired: true }] });
    expect(await completeCallback(t.deps, input({ next: "/workers" }))).toEqual({ to: "/account", company: C1 });
  });
  it("several companies: the previous one stays active, otherwise the chooser", async () => {
    const rows = [
      { companyId: C1, mfaRequired: false },
      { companyId: C2, mfaRequired: false },
    ];
    expect(await completeCallback(fake({ rows }).deps, input({ previousCompany: C2, next: "/import" }))).toEqual({ to: "/import", company: C2 });
    expect(await completeCallback(fake({ rows }).deps, input({ previousCompany: "forged" }))).toEqual({ to: "/select-company", company: null });
    expect(await completeCallback(fake({ rows }).deps, input({ previousCompany: "99999999-9999-4999-8999-999999999999" }))).toEqual({ to: "/select-company", company: null });
  });
  it("nothing but references reaches the log", async () => {
    const t = fake();
    await completeCallback(t.deps, input({ code: "SECRET-CODE", next: "/workers" }));
    expect(JSON.stringify(t.logs)).not.toMatch(/SECRET-CODE|user-1|@/);
  });
});
