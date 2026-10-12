import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), gte: vi.fn() }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/db/client", async (original) => ({
  ...(await original<typeof import("@/server/db/client")>()),
  db: () => calls,
}));
import { assertNotThrottled } from "@/server/auth/login";

beforeEach(() => {
  vi.clearAllMocks();
  calls.from.mockReturnValue(calls);
  calls.select.mockReturnValue(calls);
  calls.eq.mockReturnValue(calls);
});

it.each(["LOGIN_FAILED", "MFA_FAILED", "REAUTH_FAILED"] as const)("fails closed when the %s count cannot be read", async (event) => {
  calls.gte.mockResolvedValue({ count: null, error: { code: "08006", message: "sensitive driver detail" } });
  await expect(assertNotThrottled("company", "user", event)).rejects.toThrow("db auth throttle failed (08006)");
});

it("fails closed when an otherwise successful query has no count", async () => {
  calls.gte.mockResolvedValue({ count: null, error: null });
  await expect(assertNotThrottled("company", "user", "LOGIN_FAILED")).rejects.toThrow("db auth throttle failed");
});

it("allows fewer than five failures and rejects the fifth, scoped to the company, user and event", async () => {
  calls.gte.mockResolvedValue({ count: 4, error: null });
  await expect(assertNotThrottled("company", "user", "LOGIN_FAILED")).resolves.toBeUndefined();
  expect(calls.eq.mock.calls).toEqual([["company_id", "company"], ["entity_id", "user"], ["event", "LOGIN_FAILED"]]);
  calls.gte.mockResolvedValue({ count: 5, error: null });
  await expect(assertNotThrottled("company", "user", "LOGIN_FAILED")).rejects.toMatchObject({ status: 429, code: "THROTTLED" });
});
