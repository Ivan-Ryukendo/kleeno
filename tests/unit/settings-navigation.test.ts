import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/core/tenancy";

const state = vi.hoisted(() => ({ roles: ["OWNER"] as Role[], billingReads: vi.fn(), companyReads: vi.fn(), memberReads: vi.fn(), inviteReads: vi.fn(), push: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", userId: "user", roles: state.roles } }) }));
vi.mock("@/server/db/company", () => ({ getCompany: async (...args: unknown[]) => { state.companyReads(...args); return { profile: {}, liveEnabled: false, isDemo: true, isSandbox: false }; } }));
vi.mock("@/server/db/team", () => ({ listMembers: async (...args: unknown[]) => { state.memberReads(...args); return []; } }));
vi.mock("@/server/db/invites", () => ({ listInvites: async (...args: unknown[]) => { state.inviteReads(...args); return []; } }));
vi.mock("@/server/db/billing", () => ({ loadOwnerBilling: async (...args: unknown[]) => { state.billingReads(...args); throw new Error("private detail must not be rendered"); } }));
vi.mock("@/components/company-form", () => ({ BasicsForm: () => null, ScheduleForm: () => null }));
vi.mock("@/components/team-forms", () => ({ InviteForm: () => null, MemberActions: () => null, RevokeInviteButton: () => null }));
vi.mock("@/components/billing-provider-refresh", () => ({ BillingProviderRefresh: () => null }));
vi.mock("@/components/billing-collection-panel", () => ({ BillingCollectionPanel: () => null }));
vi.mock("@/components/ui/command", () => {
  const wrapper = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Command: wrapper, CommandDialog: wrapper, CommandEmpty: wrapper, CommandGroup: wrapper, CommandInput: () => null, CommandList: wrapper,
    CommandItem: ({ children, value }: { children?: ReactNode; value: string }) => createElement("button", { "data-value": value }, children) };
});
import CompanyPage from "@/app/(app)/(workspace)/settings/company/page";
import TeamPage from "@/app/(app)/(workspace)/settings/team/page";
import BillingPage from "@/app/(app)/(workspace)/settings/billing/page";
import { crumbs } from "@/components/shell/nav-config";
import { SearchPalette } from "@/components/shell/search-palette";

beforeEach(() => { state.roles = ["OWNER"]; for (const mock of [state.billingReads, state.companyReads, state.memberReads, state.inviteReads, state.push]) mock.mockClear(); });
function navigation(html: string) {
  const nav = html.match(/<nav[^>]*aria-label="Settings sections"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  expect(nav, "Settings sections navigation is present").toBeDefined();
  return nav!;
}
function hrefs(nav: string) { return [...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1]); }

describe("settings sections and role visibility", () => {
  it.each([
    { roles: ["OWNER"] as Role[], expected: ["/settings/company", "/settings/team", "/configuration", "/settings/billing", "/account"] },
    { roles: ["HR_APPROVER"] as Role[], expected: ["/settings/company", "/settings/team", "/configuration", "/account"] },
    { roles: ["PAYROLL_APPROVER"] as Role[], expected: ["/settings/company", "/settings/team", "/configuration", "/account"] },
    { roles: ["PAYMENT_APPROVER"] as Role[], expected: ["/settings/company", "/settings/team", "/account"] },
    { roles: ["VIEWER"] as Role[], expected: ["/settings/company", "/settings/team", "/account"] },
  ])("preserves ordered existing sections for $roles", async ({ roles, expected }) => {
    state.roles = roles;
    for (const [page, current] of [[CompanyPage, "/settings/company"], [TeamPage, "/settings/team"]] as const) {
      const nav = navigation(renderToStaticMarkup(await page()));
      expect(hrefs(nav)).toEqual(expected);
      const links = [...nav.matchAll(/<a\b([^>]*)>/g)].map(m => m[1]);
      expect(links.filter(link => link.includes('aria-current="page"'))).toHaveLength(1);
      expect(links.find(link => link.includes('aria-current="page"'))).toContain(`href="${current}"`);
      expect(nav).not.toContain("Policy library");
    }
    expect(state.companyReads).toHaveBeenCalledWith("company");
    expect(state.memberReads).toHaveBeenCalledWith("company");
    if (!roles.includes("OWNER")) expect(state.inviteReads).not.toHaveBeenCalled();
  });
  it("keeps section navigation when Owner billing evidence is unavailable", async () => {
    const html = renderToStaticMarkup(await BillingPage());
    const nav = navigation(html);
    expect(hrefs(nav)).toContain("/settings/billing");
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("No subscription or usage status is inferred");
    expect(html).not.toContain("private detail must not be rendered");
  });
  it.each(["VIEWER", "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] as const)("denies %s before private billing reads", async role => {
    state.roles = [role];
    const html = renderToStaticMarkup(await BillingPage());
    expect(html).toContain("Only the current company Owner");
    expect(state.billingReads).not.toHaveBeenCalled();
    expect(hrefs(navigation(html))).not.toContain("/settings/billing");
  });
});
describe("settings location and search", () => {
  it.each(["company", "team", "billing"])("discloses the %s settings location", section => {
    expect(crumbs(`/settings/${section}`)).toEqual(["Settings", section[0].toUpperCase() + section.slice(1)]);
  });
  it.each(["OWNER", "HR_APPROVER", "VIEWER", "PAYMENT_APPROVER"] as const)("discovers Billing only for Owner, tested as %s", role => {
    const html = renderToStaticMarkup(createElement(SearchPalette, { roles: [role], runs: [], workers: [] }));
    expect(html.includes('data-value="page Billing"')).toBe(role === "OWNER");
  });
});
