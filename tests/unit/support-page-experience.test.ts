import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import SupportPage from "@/app/(app)/(workspace)/support/page";
import AdminSupportPage from "@/app/admin/support/page";

const state = vi.hoisted(() => ({ failed: false, denied: false, customerActor: "", staffActor: "" }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => { if (state.denied) throw new Error("sign in required"); return { actor: { companyId: "company-1", userId: "requester-1" }, companies: [{ companyId: "company-1", name: "Synthetic Client" }] }; } }));
vi.mock("@/server/auth/admin", () => ({ adminPageSession: async () => { if (state.denied) throw new Error("platform admin required"); return { admin: { userId: "staff-1" }, base: "/secret-admin" }; } }));
vi.mock("@/server/db/support", () => ({ listSupport: async (actor: { companyId: string; userId: string }) => { state.customerActor = `${actor.companyId}:${actor.userId}`; if (state.failed) throw new Error("synthetic read failure"); return { tickets: [], hasMore: false }; }, listAdminSupport: async (actor: { userId: string }) => { state.staffActor = actor.userId; if (state.failed) throw new Error("synthetic read failure"); return { tickets: [], hasMore: false }; } }));
vi.mock("@/components/support-panel", () => ({ SupportPanel: ({ mode, apiBase, initialError }: { mode: string; apiBase: string; initialError?: string | null }) => `${mode} support at ${apiBase}${initialError ? `: ${initialError}` : ""}` }));
beforeEach(() => Object.assign(state, { failed: false, denied: false, customerActor: "", staffActor: "" }));
it("uses the current company/requester and protected secret admin base", async () => {
  const customer = renderToStaticMarkup(await SupportPage({ searchParams: Promise.resolve({}) }));
  expect(customer).toContain("Synthetic Client");
  expect(customer).toContain("requester support at /api/support");
  expect(state.customerActor).toBe("company-1:requester-1");
  const staff = renderToStaticMarkup(await AdminSupportPage({ searchParams: Promise.resolve({}) }));
  expect(staff).toContain("staff support at /secret-admin/api/support");
  expect(state.staffActor).toBe("staff-1");
});
it("keeps failed list reads explicit rather than presenting an empty queue as verified", async () => {
  state.failed = true;
  const customer = renderToStaticMarkup(await SupportPage({ searchParams: Promise.resolve({}) }));
  expect(customer).toContain("Support requests could not be loaded");
  const staff = renderToStaticMarkup(await AdminSupportPage({ searchParams: Promise.resolve({}) }));
  expect(staff).toContain("Support queue could not be loaded");
});
it("authenticates before invoking either support repository", async () => {
  state.denied = true;
  await expect(SupportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("sign in required");
  await expect(AdminSupportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("platform admin required");
  expect(state.customerActor).toBe(""); expect(state.staffActor).toBe("");
});
