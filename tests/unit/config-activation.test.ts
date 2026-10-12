import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  db: () => calls,
  must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("database unavailable"); return r.data; },
}));
vi.mock("@/server/crypto", () => ({ openJson: vi.fn(), sealJson: vi.fn() }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn() }));
import { configAction } from "@/server/db/configs";

const who = { companyId: "company", userId: "actor", roles: ["HR_APPROVER"] as const, correlationId: "request" };
beforeEach(() => vi.clearAllMocks());

it("activates exclusively through the tenant/actor-bound atomic replacement and audit operation", async () => {
  calls.rpc.mockResolvedValue({ data: "ACTIVE", error: null });
  expect(await configAction(who, "approved", "activate")).toBe("ACTIVE");
  expect(calls.rpc).toHaveBeenCalledExactlyOnceWith("activate_payroll_config", { p_company: "company", p_id: "approved", p_actor: "actor", p_correlation: "request" });
  expect(calls.from).not.toHaveBeenCalled();
});

it.each(["NOT_FOUND", "INVALID_TRANSITION", "FORBIDDEN", "STALE_STATE"])("fails closed on %s without an independent supersede write", async (code) => {
  calls.rpc.mockResolvedValue({ data: code, error: null });
  await expect(configAction(who, "invalid", "activate")).rejects.toMatchObject({ code });
  expect(calls.from).not.toHaveBeenCalled();
});

it("does not fall back to separate mutations when the database operation fails", async () => {
  calls.rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
  await expect(configAction(who, "approved", "activate")).rejects.toThrow();
  expect(calls.from).not.toHaveBeenCalled();
});
