import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Inventory facts are distinct from adoption, billing and commercial-readiness claims. */
export const PlatformAccountsSchema = z.object({
  scope: z.literal("CURRENT_DATABASE_INVENTORY"), asOf: z.string().datetime({ offset: true }),
  accounts: z.object({ registered: count, withActiveMembership: count, onlyDemoSandboxMemberships: count, unmarkedMemberships: count, withoutActiveMembership: count, testClassification: z.literal("UNKNOWN") }).strict(),
  companies: z.object({ total: count, demo: count, sandbox: count, demoOrSandbox: count, unmarked: count, testClassification: z.literal("UNKNOWN") }).strict(),
  memberships: z.object({ total: count, active: count, removed: count }).strict(),
  workers: z.object({ total: count, inDemoOrSandboxCompanies: count, inUnmarkedCompanies: count }).strict(),
  invitations: z.object({ total: count, pending: count, expired: count, used: count, revoked: count }).strict(),
  leads: z.object({ total: count, markedTest: count, unmarked: count }).strict(),
  commercial: z.object({ paidCompanies: z.null(), trials: z.null(), subscriptions: z.null(), activatedReviewers: z.null(), testExclusionsComplete: z.literal(false) }).strict(),
}).strict().superRefine((v, ctx) => {
  const check = (valid: boolean, path: string) => { if (!valid) ctx.addIssue({ code: "custom", path: [path], message: "inventory counts do not reconcile" }); };
  check(v.accounts.registered === v.accounts.withActiveMembership + v.accounts.withoutActiveMembership && v.accounts.withActiveMembership === v.accounts.onlyDemoSandboxMemberships + v.accounts.unmarkedMemberships && v.accounts.withActiveMembership <= v.memberships.active, "accounts");
  check(v.companies.total === v.companies.demoOrSandbox + v.companies.unmarked && v.companies.demoOrSandbox >= Math.max(v.companies.demo, v.companies.sandbox) && v.companies.demoOrSandbox <= v.companies.demo + v.companies.sandbox, "companies");
  check(v.memberships.total === v.memberships.active + v.memberships.removed, "memberships");
  check(v.workers.total === v.workers.inDemoOrSandboxCompanies + v.workers.inUnmarkedCompanies, "workers");
  check(v.invitations.total === v.invitations.pending + v.invitations.expired + v.invitations.used + v.invitations.revoked, "invitations");
  check(v.leads.total === v.leads.markedTest + v.leads.unmarked, "leads");
});
export type PlatformAccounts = z.infer<typeof PlatformAccountsSchema>;
