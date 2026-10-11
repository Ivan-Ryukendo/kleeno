import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const calls = vi.hoisted(() => ({ create: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), gte: vi.fn(), audit: vi.fn(), factors: vi.fn(), verify: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: calls.create }));
vi.mock("@/server/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic" } }));
vi.mock("@/server/db/client", async (original) => ({ ...(await original<typeof import("@/server/db/client")>()), db: () => calls }));
vi.mock("@/server/db/audit", () => ({ writeAudit: calls.audit }));
import { passwordIsValid, requireReauth, requireTotp } from "@/server/auth/login";

const actor = { companyId: "company", userId: "user", email: "user@example.invalid" };
const client = { auth: { mfa: { listFactors: calls.factors, challengeAndVerify: calls.verify } } } as unknown as SupabaseClient;

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [calls.from, calls.select, calls.eq]) method.mockReturnValue(calls);
  calls.gte.mockResolvedValue({ count: 0, error: null });
  calls.create.mockReturnValue({ auth: { signInWithPassword: calls.signIn, signOut: calls.signOut } });
  calls.signIn.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  calls.factors.mockResolvedValue({ data: { totp: [{ id: "factor", status: "verified" }] }, error: null });
  calls.verify.mockResolvedValue({ error: null });
});

it("checks the password in an isolated client and signs out only that local session", async () => {
  await expect(passwordIsValid(actor.email, "synthetic-password")).resolves.toBe(true);
  expect(calls.create).toHaveBeenCalledWith("http://localhost:54321", "synthetic", { auth: { persistSession: false, autoRefreshToken: false } });
  expect(calls.signIn).toHaveBeenCalledWith({ email: actor.email, password: "synthetic-password" });
  expect(calls.signOut).toHaveBeenCalledWith({ scope: "local" });
});

it.each([{ data: { user: null }, error: null }, { data: { user: null }, error: { message: "private provider detail" } }])("refuses unsuccessful password verification", async (result) => {
  calls.signIn.mockResolvedValue(result);
  await expect(passwordIsValid(actor.email, "wrong")).resolves.toBe(false);
});

it.each([undefined, ""])("requires a password before any provider call", async (password) => {
  await expect(requireReauth(actor, password, "corr")).rejects.toMatchObject({ status: 401 });
  expect(calls.signIn).not.toHaveBeenCalled();
});

it("audits a wrong password without persisting its value", async () => {
  calls.signIn.mockResolvedValue({ data: { user: null }, error: { message: "private provider detail" } });
  await expect(requireReauth(actor, "wrong", "corr")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(calls.audit).toHaveBeenCalledOnce();
  expect(calls.audit.mock.calls[0][0]).toMatchObject({ event: "REAUTH_FAILED", companyId: "company", entityId: "user", correlationId: "corr" });
  expect(JSON.stringify(calls.audit.mock.calls)).not.toContain("wrong");
});

it("re-checks the password for each authority request", async () => {
  await requireReauth(actor, "synthetic-password", "corr1");
  await requireReauth(actor, "synthetic-password", "corr2");
  expect(calls.signIn).toHaveBeenCalledTimes(2);
});

it.each(["password", "totp"])("throttles %s before calling the provider", async (kind) => {
  calls.gte.mockResolvedValue({ count: 5, error: null });
  await expect(kind === "password" ? requireReauth(actor, "synthetic-password", "corr") : requireTotp(client, actor, "123456", "corr")).rejects.toMatchObject({ status: 429 });
  expect(calls.signIn).not.toHaveBeenCalled();
  expect(calls.factors).not.toHaveBeenCalled();
});

it("verifies the supplied fresh code against a verified factor", async () => {
  calls.factors.mockResolvedValue({ data: { totp: [{ id: "unverified", status: "unverified" }, { id: "factor", status: "verified" }] }, error: null });
  await requireTotp(client, actor, "123456", "corr");
  expect(calls.verify).toHaveBeenCalledWith({ factorId: "factor", code: "123456" });
});

it("refuses an account with no verified factor", async () => {
  calls.factors.mockResolvedValue({ data: { totp: [{ id: "factor", status: "unverified" }] }, error: null });
  await expect(requireTotp(client, actor, "123456", "corr")).rejects.toMatchObject({ status: 401, code: "MFA_REQUIRED" });
  expect(calls.verify).not.toHaveBeenCalled();
});

it.each([
  { data: null, error: { message: "private provider detail" } },
  { data: null, error: null },
  { data: { totp: [{ id: "factor", status: "verified" }] }, error: { message: "private provider detail" } },
])("fails closed on a failed or missing factor lookup", async (result) => {
  calls.factors.mockResolvedValue(result);
  await expect(requireTotp(client, actor, "123456", "corr")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(calls.verify).not.toHaveBeenCalled();
});

it("audits an invalid fresh code without recording it", async () => {
  calls.verify.mockResolvedValue({ error: { message: "private provider detail" } });
  await expect(requireTotp(client, actor, "123456", "corr")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(calls.audit.mock.calls[0][0]).toMatchObject({ event: "MFA_FAILED", companyId: "company", entityId: "user" });
  expect(JSON.stringify(calls.audit.mock.calls)).not.toContain("123456");
});
