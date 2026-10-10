import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ owner: true, fail: false, denied: false, reads: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => { if (state.denied) throw new Error("sign in required"); return { actor: { userId: "owner", companyId: "company", roles: state.owner ? ["OWNER"] : ["PAYROLL_APPROVER"] } }; } }));
vi.mock("@/server/auth/admin", () => ({ adminPageSession: async () => { if (state.denied) throw new Error("admin required"); return { admin: { userId: "staff" }, base: "/protected" }; } }));
vi.mock("@/components/billing-admin-panel", () => ({ BillingAdminPanel: ({ apiBase, initialError }: { apiBase: string; initialError: string | null }) => `${apiBase}: ${initialError ?? "catalog"}` }));
vi.mock("@/components/billing-provider-refresh", () => ({ BillingProviderRefresh: () => "Provider refresh" }));
vi.mock("@/components/billing-collection-panel", () => ({ BillingCollectionPanel: () => "Owner-confirmed Stripe TEST actions" }));
vi.mock("@/server/db/billing", () => ({
  listBillingTiers: async () => { if (state.fail) throw new Error("unavailable"); return { tiers: [] }; },
  loadOwnerBilling: async (who: unknown) => { state.reads(who); if (state.fail) throw new Error("unavailable"); return { price: { name: "Pinned enterprise", baseCents: 12345, workerCents: 150 }, tierRevision: null, usageEnabled: true, usage: { month: "2026-10-01", uniqueWorkers: 3 }, demo: { state: "EXPIRED", expiresAt: "2026-10-08T00:00:00Z" }, subscription: { configured: false, linked: false, status: "NOT_LINKED", reconciliation: "UNVERIFIED", invoiceStatus: null, observedAt: null, cancelAtPeriodEnd: false } }; },
}));
import OwnerPage from "@/app/(app)/(workspace)/settings/billing/page";
import AdminPage from "@/app/admin/billing/page";
beforeEach(() => { state.owner = true; state.fail = false; state.denied = false; state.reads.mockClear(); });
it("renders authoritative owner terms, preview and explicit collection gates", async () => {
  const html = renderToStaticMarkup(await OwnerPage()); expect(html).toContain("Pinned enterprise"); expect(html).toContain("$123.45"); expect(html).toContain("2026-10"); expect(html).toContain("Expired"); expect(html).toContain("Owner-confirmed Stripe TEST actions"); expect(html).toContain("unconfigured"); expect(html).toContain("NOT_LINKED"); expect(state.reads).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company", userId: "owner" }));
});
it("denies non-owner and signed-out pages before company billing reads", async () => {
  state.owner = false; expect(renderToStaticMarkup(await OwnerPage())).toContain("Only the current company Owner"); expect(state.reads).not.toHaveBeenCalled();
  state.denied = true; await expect(OwnerPage()).rejects.toThrow("sign in required"); await expect(AdminPage()).rejects.toThrow("admin required");
});
it("uses protected admin path and reports unavailable records without invented totals", async () => {
  expect(renderToStaticMarkup(await AdminPage())).toContain("/protected/api/billing"); state.fail = true;
  expect(renderToStaticMarkup(await AdminPage())).toContain("Billing catalog unavailable"); expect(renderToStaticMarkup(await OwnerPage())).toContain("No subscription or usage status is inferred");
});
