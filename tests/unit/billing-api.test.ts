import { expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ options: [] as { roles?: string[]; scope?: string; body?: unknown }[], owner: vi.fn(), command: vi.fn(), tiers: vi.fn(), company: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ guarded: (options: unknown, handler: unknown) => { calls.options.push(options as never); return handler; } }));
vi.mock("@/server/db/billing", () => ({ loadOwnerBilling: calls.owner, billingAdminCommand: calls.command, listBillingTiers: calls.tiers, loadAdminBilling: calls.company }));
import { GET as ownerGet } from "@/app/api/billing/route";
import { GET as staffGet, POST as staffPost } from "@/app/api/admin/billing/route";
it("owner reads derive company from authenticated actor; admin mutations retain strict guarded body", async () => {
  expect(calls.options).toContainEqual({ roles: ["OWNER"] }); expect(calls.options).toContainEqual({ scope: "admin" }); expect(calls.options.find(o => o.body)).toMatchObject({ scope: "admin" });
  const actor = { userId: "owner", companyId: "session-company" };
  await (ownerGet as unknown as (h: unknown) => Promise<unknown>)({ actor }); expect(calls.owner).toHaveBeenCalledWith(actor);
  await (staffGet as unknown as (h: unknown) => Promise<unknown>)({ admin: { userId: "staff" }, request: new Request("http://localhost/api/admin/billing") }); expect(calls.tiers).toHaveBeenCalledWith({ userId: "staff" });
  await (staffPost as unknown as (h: unknown) => Promise<unknown>)({ admin: { userId: "staff" }, body: { action: "archive" }, correlationId: "request" }); expect(calls.command).toHaveBeenCalledWith({ userId: "staff", correlationId: "request" }, { action: "archive" });
});
