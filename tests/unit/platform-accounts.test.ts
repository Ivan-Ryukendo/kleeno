import { expect, it } from "vitest";
import { PlatformAccountsSchema } from "@/core/growth/accounts";

const inventory = {
  scope: "CURRENT_DATABASE_INVENTORY", asOf: "2026-10-07T00:00:00Z",
  accounts: { registered: 5, withActiveMembership: 3, onlyDemoSandboxMemberships: 1, unmarkedMemberships: 2, withoutActiveMembership: 2, testClassification: "UNKNOWN" },
  companies: { total: 4, demo: 1, sandbox: 2, demoOrSandbox: 2, unmarked: 2, testClassification: "UNKNOWN" },
  memberships: { total: 6, active: 4, removed: 2 }, workers: { total: 100, inDemoOrSandboxCompanies: 20, inUnmarkedCompanies: 80 },
  invitations: { total: 8, pending: 3, expired: 2, used: 2, revoked: 1 }, leads: { total: 60, markedTest: 10, unmarked: 50 },
  commercial: { paidCompanies: null, trials: null, subscriptions: null, activatedReviewers: null, testExclusionsComplete: false },
};

it("keeps authentication accounts, memberships, workers and leads distinct; multi-company members count once", () => {
  expect(PlatformAccountsSchema.parse(inventory)).toEqual(inventory);
  expect(inventory.accounts.registered).not.toBe(inventory.workers.total);
  expect(inventory.accounts.withActiveMembership).toBeLessThan(inventory.memberships.active);
});

it("rejects contradictory cohorts and overlapping demo/sandbox counts without a reconciled union", () => {
  for (const patch of [
    { accounts: { ...inventory.accounts, registered: 6 } }, { accounts: { ...inventory.accounts, withActiveMembership: 4 } },
    { companies: { ...inventory.companies, demoOrSandbox: 1 } }, { workers: { ...inventory.workers, total: 99 } },
    { memberships: { ...inventory.memberships, total: 9 } }, { invitations: { ...inventory.invitations, total: 9 } },
    { leads: { ...inventory.leads, total: 9 } },
  ]) expect(PlatformAccountsSchema.safeParse({ ...inventory, ...patch }).success).toBe(false);
});

it("refuses invented commercial readiness, non-test classifications, unsafe counts and private fields", () => {
  for (const patch of [
    { commercial: { ...inventory.commercial, paidCompanies: 5 } }, { commercial: { ...inventory.commercial, testExclusionsComplete: true } },
    { accounts: { ...inventory.accounts, testClassification: "NON_TEST" } }, { accounts: { ...inventory.accounts, registered: Number.MAX_SAFE_INTEGER + 1 } },
    { accounts: { ...inventory.accounts, registered: 5.5 } }, { emails: ["private@example.com"] },
  ]) expect(PlatformAccountsSchema.safeParse({ ...inventory, ...patch }).success).toBe(false);
});
