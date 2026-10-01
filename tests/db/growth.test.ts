// W (docs/phases/W.md): S51 growth schema server-only, S52 admin authz, S53 public submit, S54 continuation token,
// S55 abuse limits, S56 CSV export, site lockdown. Real handlers, real sessions, dev DB only.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as contactRoute } from "@/app/api/admin/contacts/[id]/route";
import { GET as exportRoute } from "@/app/api/admin/export/route";
import { POST as loginRoute } from "@/app/api/admin/login/route";
import { POST as enrollRoute } from "@/app/api/admin/mfa/enroll/route";
import { POST as verifyRoute } from "@/app/api/admin/mfa/verify/route";
import { POST as surveyRoute } from "@/app/api/waitlist/survey/route";
import { POST as joinRoute } from "@/app/api/waitlist/route";
import { POST as createWorkerRoute } from "@/app/api/workers/route";
import { admin, BASE, cookieFor, makeCompany, totp, uniq, userClient, withId, type TestCompany } from "./helpers";

const ADMIN_PATH = `t${randomBytes(16).toString("hex")}`; // 33 chars: matches the ADMIN_PATH pattern
const growth = admin.schema("growth");
const RUN = uniq();
const mail = (tag: string) => `growthtest-${RUN}-${tag}@example.com`;

type Handler = (r: Request, ctx?: never) => Promise<Response>;
interface Opts {
  method?: string;
  body?: unknown;
  cookie?: string;
  gate?: boolean;
  ip?: string;
}
/** A request as the proxy would forward it: optional admin gate header, a client IP, same-origin. */
function req(handler: Handler, o: Opts = {}, ctx?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE, "x-real-ip": o.ip ?? `10.${RUN}.${randomUUID()}` };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.gate) headers["x-kleeno-admin-gate"] = ADMIN_PATH;
  const r = new Request(`${BASE}/api/x`, { method: o.method ?? "POST", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  return (handler as (r: Request, c?: unknown) => Promise<Response>)(r, ctx);
}
const join = (body: Record<string, unknown>, ip?: string) => req(joinRoute, { body: { consent: true, elapsedMs: 5000, ...body }, ip });
const contact = async (email: string) => (await growth.from("contacts").select("*, surveys(*)").eq("email", email).maybeSingle()).data;

/** Cookie header after applying a response's Set-Cookie (empty value = deleted). */
function merge(cookie: string, res: Response) {
  const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => c.split("=", 2) as [string, string]));
  for (const sc of res.headers.getSetCookie()) {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    const [name, value] = [pair.slice(0, i), pair.slice(i + 1)];
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

let company: TestCompany;
const adminUser = { id: "", email: mail("admin"), password: `pw-${randomUUID()}` };
let adminAal1 = "";
let adminAal2 = "";
const savedMode = process.env.SITE_MODE;

beforeAll(async () => {
  process.env.ADMIN_PATH = ADMIN_PATH;
  company = await makeCompany();
  const u = await admin.auth.admin.createUser({ email: adminUser.email, password: adminUser.password, email_confirm: true });
  if (u.error || !u.data.user) throw new Error("admin user create failed");
  adminUser.id = u.data.user.id;
  expect((await growth.from("platform_admins").insert({ user_id: adminUser.id })).error).toBeNull();
  // Sign in through the admin login route, then enrol + verify TOTP through the admin MFA routes.
  const login = await req(loginRoute, { gate: true, body: { email: adminUser.email, password: adminUser.password } });
  expect(await login.json()).toMatchObject({ next: "enrol" });
  adminAal1 = merge("", login);
  const enrol = await req(enrollRoute, { gate: true, cookie: adminAal1 });
  expect(enrol.status).toBe(200);
  const { factorId, secret } = await enrol.json();
  const verify = await req(verifyRoute, { gate: true, cookie: adminAal1, body: { factorId, code: totp(secret) } });
  expect(verify.status).toBe(200);
  adminAal2 = merge(adminAal1, verify);
});

afterAll(async () => {
  process.env.SITE_MODE = savedMode;
  await growth.from("contacts").delete().like("email", `growthtest-${RUN}-%`);
  await growth.from("platform_admins").delete().eq("user_id", adminUser.id);
  await admin.auth.admin.deleteUser(adminUser.id);
});

describe("S51 growth schema is server-only", () => {
  it("every growth table has RLS on and no rights for anon or authenticated", async () => {
    const { data, error } = await admin.rpc("growth_inventory");
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThanOrEqual(7);
    for (const t of data) expect(t, t.table_name).toMatchObject({ rls_enabled: true, anon_any: false, authenticated_any: false, schema_usage_anon: false, schema_usage_authenticated: false });
  });

  it("anon and signed-in users can read or write nothing through the public API", async () => {
    await join({ email: mail("private"), companyName: "Private Co" });
    const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const user = await userClient(company.payroll);
    for (const c of [anon, user]) {
      for (const t of ["contacts", "surveys", "survey_tokens", "contact_events", "admin_events", "rate_limits", "platform_admins"]) {
        const r = await c.schema("growth").from(t).select("*").limit(1);
        expect(r.error, t).not.toBeNull();
        expect(r.data ?? [], t).toEqual([]);
      }
      expect((await c.schema("growth").from("contacts").insert({ email: mail("forged"), consent_version: "x", consented_at: new Date().toISOString() })).error).not.toBeNull();
      expect((await c.schema("growth").rpc("join_waitlist", { p_email: mail("rpc") })).error).not.toBeNull();
    }
    expect((await anon.rpc("growth_inventory")).error).not.toBeNull();
  });
});

describe("S53 public sign-up", () => {
  it("valid email -> saved lower-cased and trimmed, with a survey token; the reply holds no personal data", async () => {
    const res = await join({ email: `  ${mail("Valid").toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ok", "token"]);
    expect(body.token).toMatch(/^[\w-]{43}$/);
    const c = await contact(mail("valid"));
    expect(c).toMatchObject({ email: mail("valid"), status: "NEW", is_test: false, consent_version: "2026-10-01" });
  });

  it("invalid email, missing consent, forged fields or bad enums -> 400 and nothing saved", async () => {
    for (const bad of [{ email: "not-an-email" }, { email: mail("noconsent"), consent: false }, { email: mail("forged"), status: "PILOT_CANDIDATE" }, { email: mail("forged"), isTest: true }, { email: mail("forged"), painPoint: "BOGUS" }]) {
      expect((await join(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await contact(mail("noconsent"))).toBeNull();
    expect(await contact(mail("forged"))).toBeNull();
  });

  it("duplicate email -> same reply shape, nothing changes, one row (first write wins)", async () => {
    await join({ email: mail("dup") });
    const again = await join({ email: mail("dup"), companyName: "Overwrite Ltd", painPoint: "OTHER" });
    expect(again.status).toBe(200);
    expect((await again.json()).ok).toBe(true);
    const rows = (await growth.from("contacts").select("id, company_name, surveys(*)").eq("email", mail("dup"))).data!;
    expect(rows).toHaveLength(1);
    expect(rows[0].company_name).toBeNull();
    expect(rows[0].surveys).toBeNull();
  });

  it("concurrent duplicate submissions -> exactly one row", async () => {
    await Promise.all(Array.from({ length: 5 }, () => join({ email: mail("race") })));
    expect((await growth.from("contacts").select("id").eq("email", mail("race"))).data).toHaveLength(1);
  });

  it("honeypot or a too-fast form -> same reply, nothing saved", async () => {
    expect((await join({ email: mail("bot1"), website: "http://spam" })).status).toBe(200);
    expect((await join({ email: mail("bot2"), elapsedMs: 100 })).status).toBe(200);
    expect(await contact(mail("bot1"))).toBeNull();
    expect(await contact(mail("bot2"))).toBeNull();
  });
});

describe("S54 survey", () => {
  it("email-first then survey -> one contact, one survey, empty profile fields filled", async () => {
    const { token } = await (await join({ email: mail("first") })).json();
    const res = await req(surveyRoute, { body: { token, painPoint: "RECONCILIATION", budgetBand: "100_299", wantsCall: true, role: "FINANCE", companyName: "Acme" } });
    expect(res.status).toBe(200);
    const c = await contact(mail("first"));
    expect(c).toMatchObject({ role: "FINANCE", company_name: "Acme", surveys: { pain_point: "RECONCILIATION", budget_band: "100_299", wants_call: true } });
  });

  it("the token works once: a second survey changes nothing", async () => {
    const { token } = await (await join({ email: mail("once") })).json();
    await req(surveyRoute, { body: { token, painPoint: "CONFIGURATION" } });
    expect((await req(surveyRoute, { body: { token, painPoint: "OTHER", companyName: "Late" } })).status).toBe(200);
    const c = await contact(mail("once"));
    expect(c.surveys.pain_point).toBe("CONFIGURATION");
    expect(c.company_name).toBeNull();
  });

  it("an expired or unknown token -> same reply, nothing saved", async () => {
    const { token } = await (await join({ email: mail("expired") })).json();
    const c = await contact(mail("expired"));
    await growth.from("survey_tokens").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("contact_id", c.id);
    expect((await req(surveyRoute, { body: { token, painPoint: "OTHER" } })).status).toBe(200);
    expect((await req(surveyRoute, { body: { token: randomBytes(32).toString("base64url"), painPoint: "OTHER" } })).status).toBe(200);
    expect((await contact(mail("expired"))).surveys).toBeNull();
  });

  it("combined form -> contact and survey in one request, no token", async () => {
    const res = await join({ email: mail("combined"), painPoint: "CONTRACTOR_PAYMENTS", budgetBand: "UNSURE", wantsCall: false });
    expect((await res.json()).token).toBeNull();
    expect((await contact(mail("combined"))).surveys).toMatchObject({ pain_point: "CONTRACTOR_PAYMENTS", budget_band: "UNSURE", wants_call: false });
  });

  it("skipped survey keeps the sign-up; a stranger re-entering the email cannot add answers", async () => {
    await join({ email: mail("skipped") });
    await join({ email: mail("skipped"), painPoint: "OTHER", budgetBand: "500_PLUS" });
    const c = await contact(mail("skipped"));
    expect(c).not.toBeNull();
    expect(c.surveys).toBeNull();
  });

  it("invalid survey enum or token format -> 400", async () => {
    const { token } = await (await join({ email: mail("enum") })).json();
    expect((await req(surveyRoute, { body: { token, budgetBand: "1_MILLION" } })).status).toBe(400);
    expect((await req(surveyRoute, { body: { token: "short", painPoint: "OTHER" } })).status).toBe(400);
  });
});

describe("S55 rate limit", () => {
  it("the 11th sign-up from one IP within 10 minutes -> 429", async () => {
    const ip = `rl-${RUN}`;
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await join({ email: mail(`rl${i}`), website: "bot" }, ip)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("site lockdown", () => {
  it("payroll API routes are 404 in waitlist mode; the waitlist API still works", async () => {
    process.env.SITE_MODE = "waitlist";
    try {
      expect((await req(createWorkerRoute, { body: {} })).status).toBe(404);
      expect((await join({ email: mail("mode") })).status).toBe(200);
    } finally {
      process.env.SITE_MODE = savedMode;
    }
    expect((await req(createWorkerRoute, { body: {} })).status).toBe(401); // app mode: back to normal auth
  });
});

describe("S52 admin access", () => {
  it("without the proxy gate every admin route is 404, even for a signed-in admin", async () => {
    expect((await req(exportRoute, { method: "GET", cookie: adminAal2 })).status).toBe(404);
    expect((await req(loginRoute, { body: { email: adminUser.email, password: adminUser.password } })).status).toBe(404);
  });

  it("signed out -> 401; company approver -> 403; admin without MFA -> 401; admin with MFA -> 200", async () => {
    expect((await req(exportRoute, { method: "GET", gate: true })).status).toBe(401);
    expect((await req(exportRoute, { method: "GET", gate: true, cookie: (await cookieFor(company.payroll)).cookie })).status).toBe(403);
    const aal1 = await req(exportRoute, { method: "GET", gate: true, cookie: adminAal1 });
    expect(aal1.status).toBe(401);
    expect((await aal1.json()).error.code).toBe("MFA_REQUIRED");
    expect((await req(exportRoute, { method: "GET", gate: true, cookie: adminAal2 })).status).toBe(200);
  });

  it("admin login: wrong password and a non-admin account get the same 401 and no session cookie", async () => {
    const wrong = await req(loginRoute, { gate: true, body: { email: adminUser.email, password: "wrong-password-123" } });
    const notAdmin = await req(loginRoute, { gate: true, body: { email: company.payroll.email, password: company.payroll.password } });
    for (const r of [wrong, notAdmin]) {
      expect(r.status).toBe(401);
      expect((await r.json()).error.message).toBe("Invalid email or password");
      expect(r.headers.getSetCookie()).toEqual([]);
    }
  });

  it("an admin with a verified factor must use it before enrolling another", async () => {
    const login = await req(loginRoute, { gate: true, body: { email: adminUser.email, password: adminUser.password } });
    expect(await login.json()).toMatchObject({ next: "mfa" });
    expect((await req(enrollRoute, { gate: true, cookie: merge("", login) })).status).toBe(401);
  });
});

describe("S52 admin actions", () => {
  it("named actions change status and write history; SAVE stores notes; non-admins change nothing", async () => {
    await join({ email: mail("lead") });
    const c = await contact(mail("lead"));
    expect((await req(contactRoute, { gate: true, cookie: (await cookieFor(company.payroll)).cookie, body: { action: "QUALIFY" } }, withId(c.id))).status).toBe(403);
    expect((await req(contactRoute, { gate: true, cookie: adminAal2, body: { action: "QUALIFY" } }, withId(c.id))).status).toBe(200);
    expect((await req(contactRoute, { gate: true, cookie: adminAal2, body: { action: "SAVE", notes: "Call Tuesday", nextActionAt: "2026-10-07", isTest: true } }, withId(c.id))).status).toBe(200);
    expect((await req(contactRoute, { gate: true, cookie: adminAal2, body: { action: "SET", status: "CLOSED" } }, withId(c.id))).status).toBe(400);
    const after = await contact(mail("lead"));
    expect(after).toMatchObject({ status: "QUALIFIED", notes: "Call Tuesday", next_action_at: "2026-10-07", is_test: true });
    const events = (await growth.from("contact_events").select("from_status, to_status, actor").eq("contact_id", c.id)).data;
    expect(events).toEqual([{ from_status: "NEW", to_status: "QUALIFIED", actor: adminUser.id }]);
    expect((await growth.from("contact_events").update({ to_status: "CLOSED" }).eq("contact_id", c.id)).error).not.toBeNull();
  });

  it("DELETE removes the contact and its survey; the admin event holds no email", async () => {
    await join({ email: mail("gone"), painPoint: "OTHER" });
    const c = await contact(mail("gone"));
    expect((await req(contactRoute, { gate: true, cookie: adminAal2, body: { action: "DELETE", confirm: "DELETE" } }, withId(c.id))).status).toBe(200);
    expect(await contact(mail("gone"))).toBeNull();
    expect((await growth.from("surveys").select("contact_id").eq("contact_id", c.id)).data).toEqual([]);
    const ev = (await growth.from("admin_events").select("*").eq("actor", adminUser.id).eq("action", "CONTACT_DELETED")).data!;
    expect(ev.length).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toContain("@");
    expect((await req(contactRoute, { gate: true, cookie: adminAal2, body: { action: "QUALIFY" } }, withId(c.id))).status).toBe(409);
  });
});

describe("S56 CSV export", () => {
  it("cells that would run as formulas are neutralised; the response is never cached; the export is logged", async () => {
    await join({ email: mail("csv"), companyName: '=HYPERLINK("http://evil","x")', painPoint: "OTHER" });
    const res = await req(exportRoute, { method: "GET", gate: true, cookie: adminAal2 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
    expect((await growth.from("admin_events").select("id").eq("actor", adminUser.id).eq("action", "EXPORT")).data!.length).toBeGreaterThan(0);
  });
});
