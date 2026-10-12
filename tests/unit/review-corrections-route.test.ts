import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ load: vi.fn(), link: vi.fn(), options: [] as { roles: string[]; body?: unknown }[] }));
vi.mock("@/server/auth/guard", () => ({ guarded: (options: { roles: string[]; body?: unknown }, handler: unknown) => { calls.options.push(options); return handler; } }));
vi.mock("@/server/db/review-corrections", () => ({ loadReviewCorrections: calls.load, linkReviewCorrection: calls.link }));
import { GET, POST } from "@/app/api/runs/[id]/corrections/route";
const id = "10000000-0000-4000-8000-000000000001", actor = { companyId: id, userId: id, roles: ["HR_APPROVER"] }, client = {};
beforeEach(() => { calls.load.mockReset(); calls.link.mockReset(); });
it("uses financial read and strict payroll-only write guards and never caches correction evidence", async () => {
  calls.load.mockResolvedValue({ links: [] });
  const response = await GET({ actor, client, params: { id }, correlationId: "test", request: new Request(`http://localhost/api/runs/${id}/corrections?replacement=${id}`) } as never);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(calls.load).toHaveBeenCalledWith(client, { ...actor, correlationId: "test" }, id, id);
  expect(calls.options[0].roles).toEqual(["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"]);
  expect(calls.options[1].roles).toEqual(["HR_APPROVER", "PAYROLL_APPROVER"]);
  expect(calls.options[1].body).toBeDefined();
});
it("validates path UUID before write and binds actor/company/correlation from authenticated context", async () => {
  await expect(POST({ actor, client, params: { id: "invalid" }, body: {}, correlationId: "test" } as never)).rejects.toThrow();
  expect(calls.link).not.toHaveBeenCalled();
  calls.link.mockResolvedValue({ id });
  await POST({ actor, client, params: { id }, body: { reason: "synthetic" }, correlationId: "test" } as never);
  expect(calls.link).toHaveBeenCalledWith(client, { ...actor, correlationId: "test" }, id, { reason: "synthetic" });
});
