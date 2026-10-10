import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminHome from "@/app/admin/page";

const state = vi.hoisted(() => ({ failed: false, denied: false, reads: 0, actor: "" }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/auth/admin", () => ({ adminPageSession: async () => { if (state.denied) throw new Error("platform admin required"); return { base: "/private-admin", admin: { userId: "platform-admin-1" } }; } }));
vi.mock("@/components/admin-forms", () => ({ AdminSignOut: () => null, LiveRequestActions: () => null }));
vi.mock("@/server/db/settlement", () => ({ liveRequests: async () => [] }));
vi.mock("@/server/db/growth", () => ({ PAGE_SIZE: 50, listContacts: async () => ({ rows: [], total: 0 }), metricRows: async () => Array.from({ length: 3 }, () => ({ status: "NEW", is_test: false, role: null, source: null, utm_source: null, surveys: null })) }));
vi.mock("@/server/db/platform-accounts", () => ({ loadPlatformAccounts: async (actor: { userId: string }) => {
  state.reads++; state.actor = actor.userId;
  if (state.failed) throw new Error("synthetic count read failure");
  return { scope: "CURRENT_DATABASE_INVENTORY", asOf: "2026-10-07T10:00:00Z", accounts: { registered: 7, withActiveMembership: 4, onlyDemoSandboxMemberships: 1, unmarkedMemberships: 3, withoutActiveMembership: 3, testClassification: "UNKNOWN" }, companies: { total: 5, demo: 1, sandbox: 1, demoOrSandbox: 2, unmarked: 3, testClassification: "UNKNOWN" }, memberships: { total: 6, active: 4, removed: 2 }, workers: { total: 10, inDemoOrSandboxCompanies: 5, inUnmarkedCompanies: 5 }, invitations: { total: 3, pending: 1, expired: 1, used: 1, revoked: 0 }, leads: { total: 4, markedTest: 1, unmarked: 3 }, commercial: { paidCompanies: null, trials: null, subscriptions: null, activatedReviewers: null, testExclusionsComplete: false } };
} }));

const render = async () => renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));
describe("platform inventory presentation", () => {
  beforeEach(() => { Object.assign(state, { failed: false, denied: false, reads: 0, actor: "" }); });
  it("distinguishes actual registered accounts from waitlist leads and passes the authenticated admin", async () => {
    const html = await render();
    expect(html).toContain("Registered accounts");
    expect(html).toContain("Waitlist leads");
    expect(html).not.toContain(">Sign-ups<");
    expect(html).toMatch(/<time datetime="2026-10-07T10:00:00Z"/i);
    expect(state.actor).toBe("platform-admin-1");
  });
  it("shows known cohorts and makes test/customer classification and commercial measurements unavailable", async () => {
    const html = await render();
    expect(html).toContain("Demo or sandbox companies");
    expect(html).toContain("Unmarked does not mean non-test or paying");
    expect(html).toContain("Paid companies");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Activated reviewers");
    expect(html).toContain("Test exclusions are incomplete");
    expect(html).not.toContain("7 customers");
  });
  it("keeps a count-read failure explicit while retaining the existing lead workflow", async () => {
    state.failed = true;
    const html = await render();
    expect(html).toContain("Account inventory could not be loaded");
    expect(html).toContain("Waitlist leads");
    expect(html).not.toContain("Registered accounts</dt><dd>0");
  });
  it("never reads inventory before platform admin authorization", async () => {
    state.denied = true;
    await expect(render()).rejects.toThrow("platform admin required");
    expect(state.reads).toBe(0);
  });
});
