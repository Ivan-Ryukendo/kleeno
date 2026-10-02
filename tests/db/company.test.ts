// P3b slices 3-5: company profile and wizard (Owner only), team management (S63), more companies (S64), setup checklist.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as companiesRoute } from "@/app/api/companies/route";
import { POST as companyRoute } from "@/app/api/company/route";
import { POST as teamRoute } from "@/app/api/team/[id]/route";
import { POST as queryRoute } from "@/app/api/views/query/route";
import { setupChecklist } from "@/core/setup";
import { defaultView } from "@/core/views";
import { parseUsdc } from "@/core/money";
import { setupFacts } from "@/server/db/company";
import { createWorker } from "@/server/db/workers";
import { COMPANY_COOKIE, signCompany } from "@/server/auth/company";
import { activeConfig, admin, call, cookieFor, joinCompany, makeCompany, withId, type TestCompany, type TestUser } from "./helpers";

let a: TestCompany;
let owner: string;
let pay: string;
const BASICS = { name: "Acme Ltd", country: "US", timezone: "America/New_York", sizeRange: "11_50", industry: "SOFTWARE" };
const SCHEDULE = { payFrequency: "MONTHLY", payDay: 25 };
/** Session cookie plus the signed active-company cookie, as a browser would send them. */
const login = async (u: TestUser, companyId: string) => `${(await cookieFor(u)).cookie}; ${COMPANY_COOKIE}=${signCompany(companyId)}`;
const row = async (id: string) => (await admin.from("companies").select("*").eq("id", id).single()).data!;

beforeAll(async () => {
  a = await makeCompany();
  owner = await login(a.payroll, a.id);
  pay = await login(a.payment, a.id);
});

describe("company profile and onboarding (Owner only)", () => {
  it("saves the basics, then the pay schedule; the wizard is finished when both are there", async () => {
    expect((await row(a.id)).onboarded_at).toBeNull();
    const first = await call(companyRoute, { cookie: owner, body: BASICS });
    expect(first.status).toBe(200);
    expect((await first.json()).onboarded).toBe(false);
    const second = await call(companyRoute, { cookie: owner, body: SCHEDULE });
    expect((await second.json()).onboarded).toBe(true);
    expect(await row(a.id)).toMatchObject({ name: "Acme Ltd", country: "US", timezone: "America/New_York", size_range: "11_50", industry: "SOFTWARE", pay_frequency: "MONTHLY", pay_day: 25 });
    expect((await row(a.id)).onboarded_at).not.toBeNull();
  });

  it("refuses unknown countries, time zones and pay days that do not fit the frequency", async () => {
    for (const bad of [
      { ...BASICS, country: "ZZ" },
      { ...BASICS, timezone: "Mars/Base" },
      { ...BASICS, sizeRange: "HUGE" },
      { payFrequency: "MONTHLY", payDay: 30 },
      { payFrequency: "WEEKLY", payDay: 9 },
      { payFrequency: "SEMI_MONTHLY", payDay: 5 },
      { ...BASICS, company_id: randomUUID() },
      { ...BASICS, onboarded_at: "2020-01-01" },
    ])
      expect((await call(companyRoute, { cookie: owner, body: bad })).status, JSON.stringify(bad)).toBe(400);
    expect((await call(companyRoute, { cookie: owner, body: { payFrequency: "SEMI_MONTHLY", payDay: null } })).status).toBe(200);
  });

  it("only an Owner can change company details", async () => {
    expect((await call(companyRoute, { cookie: pay, body: BASICS })).status).toBe(403);
  });
});

describe("S63 team management", () => {
  it("granting payroll or payment authority needs the Owner's password; other roles do not", async () => {
    const target = a.payment.id;
    const roles = ["PAYMENT_APPROVER", "PAYROLL_APPROVER"];
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles } }, withId(target))).status).toBe(401);
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles, password: "wrong-password" } }, withId(target))).status).toBe(401);
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles, password: a.payroll.password } }, withId(target))).status).toBe(200);
    expect((await admin.from("memberships").select("roles").eq("user_id", target).eq("company_id", a.id).single()).data!.roles.sort()).toEqual(roles.sort());
    // keeping or narrowing needs no password (it widens nothing)
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles: ["PAYMENT_APPROVER", "VIEWER"] } }, withId(target))).status).toBe(200);
  });

  it("only an Owner manages the team, nobody edits their own roles, and unknown members are 404", async () => {
    expect((await call(teamRoute, { cookie: pay, body: { action: "set_roles", roles: ["OWNER"] } }, withId(a.payroll.id))).status).toBe(403);
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles: ["VIEWER", "OWNER"] } }, withId(a.payroll.id))).status).toBe(403);
    expect((await call(teamRoute, { cookie: owner, body: { action: "remove" } }, withId(randomUUID()))).status).toBe(404);
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles: ["VIEWER"], company_id: randomUUID() } }, withId(a.payment.id))).status).toBe(400);
    expect((await call(teamRoute, { cookie: owner, body: { action: "set_roles", roles: ["ADMIN"] } }, withId(a.payment.id))).status).toBe(400);
  });

  it("the last Owner cannot be removed or demoted; with a second Owner the first can be demoted", async () => {
    const co = await makeCompany();
    const second = co.payment;
    const ownerCookie = await login(co.payroll, co.id);
    // the only Owner tries to hand the role away and leave: demoting someone else changes nothing about the Owner count
    expect((await call(teamRoute, { cookie: ownerCookie, body: { action: "remove" } }, withId(co.payroll.id))).status).toBe(403); // not yourself
    await call(teamRoute, { cookie: ownerCookie, body: { action: "set_roles", roles: ["OWNER", "VIEWER"] } }, withId(second.id));
    const secondCookie = await login(second, co.id);
    expect((await call(teamRoute, { cookie: secondCookie, body: { action: "set_roles", roles: ["VIEWER"] } }, withId(co.payroll.id))).status).toBe(200); // two Owners: allowed
    expect((await call(teamRoute, { cookie: secondCookie, body: { action: "remove" } }, withId(co.payroll.id))).status).toBe(200);
    // now `second` is the only Owner; nobody else can act, and the DB trigger agrees
    expect((await admin.from("memberships").update({ roles: ["VIEWER"] }).eq("user_id", second.id).eq("company_id", co.id)).error).not.toBeNull();
    expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("user_id", second.id).eq("company_id", co.id)).error).not.toBeNull();
  });

  it("a removed member loses access at the next request", async () => {
    const co = await makeCompany();
    const ownerCookie = await login(co.payroll, co.id);
    const memberCookie = await login(co.payment, co.id);
    const view = { view: defaultView("workers", ["PAYMENT_APPROVER"]), runId: null };
    expect((await call(queryRoute, { cookie: memberCookie, body: view })).status).toBe(200);
    expect((await call(teamRoute, { cookie: ownerCookie, body: { action: "remove" } }, withId(co.payment.id))).status).toBe(200);
    expect((await call(queryRoute, { cookie: memberCookie, body: view })).status).toBe(403);
    expect((await admin.from("memberships").select("removed_at").eq("user_id", co.payment.id).eq("company_id", co.id).single()).data!.removed_at).not.toBeNull(); // kept, not deleted
  });
});

describe("S64 more companies", () => {
  it("an Owner starts another company: SIMULATION, live payments off, MFA required, Owner membership, and it becomes active", async () => {
    const res = await call(companiesRoute, { cookie: owner, body: { name: "Second Co" } });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(res.headers.get("set-cookie") ?? "").toContain("kleeno-company=");
    expect(await row(id)).toMatchObject({ name: "Second Co", is_sandbox: false, live_payments_enabled: false, mfa_required: true });
    expect((await admin.from("memberships").select("roles").eq("user_id", a.payroll.id).eq("company_id", id).single()).data!.roles).toEqual(["OWNER"]);
  });

  it("only an Owner can; a sandbox owner can only create sandboxes", async () => {
    expect((await call(companiesRoute, { cookie: pay, body: { name: "Nope" } })).status).toBe(403);
    const sb = await makeCompany();
    await admin.from("companies").update({ is_sandbox: true }).eq("id", sb.id);
    const res = await call(companiesRoute, { cookie: await login(sb.payroll, sb.id), body: { name: "Sandbox two" } });
    expect(res.status).toBe(200);
    expect((await row((await res.json()).id)).is_sandbox).toBe(true);
  });

  it("at most 5 a day", async () => {
    const co = await makeCompany();
    const cookie = await login(co.payroll, co.id);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call(companiesRoute, { cookie, body: { name: `Bulk ${i}` } })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 403]);
  });
});

describe("setup checklist", () => {
  it("is computed from what exists", async () => {
    const co = await makeCompany();
    const done = async () => setupChecklist(await setupFacts(co.id)).items.filter((i) => i.done).map((i) => i.id);
    expect(await done()).toEqual(["team"]); // makeCompany already has two members
    await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("user_id", co.payment.id).eq("company_id", co.id);
    expect(await done()).toEqual([]);
    await joinCompany(co.payment, co.id, ["VIEWER"]).catch(() => undefined); // removed members come back through an invite, not an insert
    await createWorker({ companyId: co.id, userId: co.payroll.id, correlationId: randomUUID() }, { pseudonym: "W801", payType: "SALARIED", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: 0n } });
    expect(await done()).toEqual(["workers"]);
    await activeConfig(co);
    expect(await done()).toEqual(["workers", "policy"]);
    await admin.from("payroll_runs").insert({ company_id: co.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: 1, created_by: co.payroll.id });
    expect(await done()).toEqual(["workers", "policy", "run"]);
    expect(setupChecklist(await setupFacts(co.id)).next?.id).toBe("team");
  });
});
