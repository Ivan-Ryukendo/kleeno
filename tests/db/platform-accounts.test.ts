// Local isolated Supabase acceptance; do not run this against a remote .env target.
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { PlatformAccountsSchema } from "@/core/growth/accounts";
import { GET } from "@/app/api/admin/accounts/route";
import { admin, cookieFor, joinCompany, makeCompany, uniq, userClient } from "./helpers";

const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });
async function platformActor() {
  const company = await makeCompany();
  expect((await admin.schema("growth").from("platform_admins").insert({ user_id: company.payroll.id })).error).toBeNull();
  cleanup.push(async () => admin.schema("growth").from("platform_admins").delete().eq("user_id", company.payroll.id));
  return company;
}
const inventory = async (actor: string) => {
  const result = await admin.rpc("platform_account_inventory", { p_actor: actor });
  expect(result.error).toBeNull();
  return PlatformAccountsSchema.parse(result.data);
};

it("counts authentication accounts once across companies; workers and waitlist entries never inflate user counts", async () => {
  const actor = await platformActor(), before = await inventory(actor.payroll.id);
  const demo = await makeCompany(), ordinary = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, is_sandbox: true }).eq("id", demo.id)).error).toBeNull();
  await joinCompany(demo.payroll, ordinary.id, ["VIEWER"]);
  const orphan = await admin.auth.admin.createUser({ email: `dbtest-unassigned-${uniq()}@example.com`, email_confirm: true });
  expect(orphan.error).toBeNull(); cleanup.push(async () => admin.auth.admin.deleteUser(orphan.data.user!.id));
  const after = await inventory(actor.payroll.id);
  expect(after.accounts.registered - before.accounts.registered).toBe(5);
  expect(after.accounts.withActiveMembership - before.accounts.withActiveMembership).toBe(4);
  expect(after.memberships.active - before.memberships.active).toBe(5);
  expect(after.accounts.onlyDemoSandboxMemberships - before.accounts.onlyDemoSandboxMemberships).toBe(1);
  expect(after.accounts.unmarkedMemberships - before.accounts.unmarkedMemberships).toBe(3);
  expect(after.accounts.withoutActiveMembership - before.accounts.withoutActiveMembership).toBe(1);
  expect(after.companies.demo - before.companies.demo).toBe(1);
  expect(after.companies.sandbox - before.companies.sandbox).toBe(1);
  expect(after.companies.demoOrSandbox - before.companies.demoOrSandbox).toBe(1);
  expect(after.workers.total).toBe(before.workers.total);
  expect(after.leads.total).toBe(before.leads.total);
  expect(after.accounts.testClassification).toBe("UNKNOWN");
  expect(after.commercial).toEqual({ paidCompanies: null, trials: null, subscriptions: null, activatedReviewers: null, testExclusionsComplete: false });
  expect(JSON.stringify(after)).not.toMatch(/@example|password|wallet|gross|deductions|token/);
});

it("refuses company roles, public RPC execution and revoked platform-admin membership", async () => {
  const company = await makeCompany(), actor = await platformActor();
  expect((await admin.rpc("platform_account_inventory", { p_actor: company.payroll.id })).data).toEqual({ code: "FORBIDDEN" });
  const client = await userClient(company.payroll);
  expect((await client.rpc("platform_account_inventory", { p_actor: actor.payroll.id })).error).not.toBeNull();
  expect((await admin.schema("growth").from("platform_admins").delete().eq("user_id", actor.payroll.id)).error).toBeNull();
  expect((await admin.rpc("platform_account_inventory", { p_actor: actor.payroll.id })).data).toEqual({ code: "FORBIDDEN" });
});

it("requires the secret-path gate and MFA even for an actual password-signed-in platform admin", async () => {
  const actor = await platformActor(), { cookie } = await cookieFor(actor.payroll);
  const previous = process.env.ADMIN_PATH, secret = randomUUID().replaceAll("-", ""); process.env.ADMIN_PATH = secret;
  try {
    expect((await GET(new Request("http://localhost:3000/api/admin/accounts", { headers: { cookie } }))).status).toBe(404);
    const response = await GET(new Request("http://localhost:3000/api/admin/accounts", { headers: { cookie, "x-kleeno-admin-gate": secret } }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("MFA_REQUIRED");
  } finally { if (previous === undefined) delete process.env.ADMIN_PATH; else process.env.ADMIN_PATH = previous; }
});
