// S62 invites, S63 (re-auth for authority roles), S64 (access approval, sandboxes). Real handlers, real sessions.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as acceptRoute } from "@/app/api/invites/accept/route";
import { POST as inviteRoute } from "@/app/api/invites/route";
import { POST as revokeRoute } from "@/app/api/invites/[id]/revoke/route";
import { INVALID_INVITE_MESSAGE } from "@/core/invites";
import { approveAccess } from "@/server/db/access";
import { issueInvite, listInvites, peekInvite, revokeInvite } from "@/server/db/invites";
import { admin, call, cookieFor, joinCompany, makeCompany, uniq, withId, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let owner: string; // session cookie of company A's Owner
let nextIp = 0;
const ip = () => `10.77.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
const email = () => `dbtest-${uniq()}@example.com`;
const PASSWORD = () => `pw-${randomUUID()}`;
const tokenOf = (link: string) => link.split("/invite/")[1];
const accept = (token: string, password: string, extra: object = {}) => call(acceptRoute, { body: { token, password, ...extra }, ip: ip(), path: "/api/invites/accept" });

async function invite(c: TestCompany, to: string, roles: string[], cookie = owner, password?: string) {
  const res = await call(inviteRoute, { cookie, body: { email: to, roles, ...(password ? { password } : {}) } });
  return { res, body: res.status === 200 ? await res.clone().json() : await res.clone().json().catch(() => ({})) };
}

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  owner = (await cookieFor(a.payroll)).cookie;
});

describe("S62 an invite is one-time, bound to one email, and answers every failure the same way", () => {
  it("stores only a hash, creates the account on the server, and signs the new member in with the company active", async () => {
    const to = email();
    const { res, body } = await invite(a, to, ["VIEWER"]);
    expect(res.status).toBe(200);
    const token = tokenOf(body.link);
    expect(token).toHaveLength(43);
    const stored = (await admin.from("invites").select("*").eq("id", body.id).single()).data!;
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.token_hash).toBe(createHash("sha256").update(token).digest("hex"));

    const pw = PASSWORD();
    const ok = await accept(token, pw);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kleeno-company=");
    expect(setCookie).toContain("sb-"); // a session
    const member = (await admin.from("memberships").select("roles, email, user_id, company_id").eq("company_id", a.id).eq("email", to).single()).data!;
    expect(member.roles).toEqual(["VIEWER"]);
    expect((await admin.auth.admin.getUserById(member.user_id)).data.user?.email).toBe(to);
    expect((await listInvites(a.id)).find((i) => i.id === body.id)?.status).toBe("USED");
  });

  it("a used, unknown, expired or revoked link gets one identical reply", async () => {
    const to = email();
    const fresh = tokenOf((await invite(a, to, ["VIEWER"])).body.link);
    expect((await accept(fresh, PASSWORD())).status).toBe(200);

    const expiredToken = randomBytes(32).toString("base64url");
    const expiredInsert = await admin.from("invites").insert({ company_id: a.id, email: email(), roles: ["VIEWER"], issuer: "OWNER", issued_by: a.payroll.id, token_hash: createHash("sha256").update(expiredToken).digest("hex"), expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(expiredInsert.error).toBeNull(); // its expiry has already passed
    const revokedInvite = await issueInvite({ companyId: a.id, email: email(), roles: ["VIEWER"], issuer: "OWNER", issuedBy: a.payroll.id, correlationId: randomUUID() });
    await revokeInvite(a.id, revokedInvite.id, a.payroll.id, randomUUID());

    const replies = [];
    for (const t of [fresh, expiredToken, "y".repeat(43), revokedInvite.token]) {
      const r = await accept(t, PASSWORD());
      replies.push([r.status, (await r.json()).error.message]);
    }
    expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(replies[0]).toEqual([403, INVALID_INVITE_MESSAGE]);
    expect((await accept("short", PASSWORD())).status).toBe(400); // a malformed token never reaches the lookup
  });

  it("the account email is the invite's: the body cannot name another", async () => {
    const t = tokenOf((await invite(a, email(), ["VIEWER"])).body.link);
    expect((await accept(t, PASSWORD(), { email: "someone@else.example" })).status).toBe(400);
    expect(await peekInvite(t)).not.toBeNull(); // nothing was burned
  });

  it("an existing account joins a second company with its password; a wrong password burns nothing and is throttled", async () => {
    const person = b.payment; // a login that already belongs to company B
    const t = tokenOf((await invite(a, person.email, ["VIEWER"])).body.link);
    const bad = await accept(t, "not-the-password");
    expect(bad.status).toBe(401);
    expect(await peekInvite(t)).not.toBeNull();
    const ok = await accept(t, person.password);
    expect(ok.status).toBe(200);
    const roles = ((await admin.from("memberships").select("company_id, roles").eq("user_id", person.id)).data ?? []).map((m: { company_id: string }) => m.company_id).sort();
    expect(roles).toEqual([a.id, b.id].sort());

    const other = b.payroll;
    const t2 = tokenOf((await invite(a, other.email, ["VIEWER"])).body.link);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await accept(t2, "nope")).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it("a re-invite replaces the pending one, and an active member cannot be invited", async () => {
    const to = email();
    const first = (await invite(a, to, ["VIEWER"])).body;
    const second = (await invite(a, to, ["HR_APPROVER"])).body;
    expect(await peekInvite(tokenOf(first.link))).toBeNull();
    expect(await peekInvite(tokenOf(second.link))).not.toBeNull();
    const dup = await invite(a, a.payment.email, ["VIEWER"]);
    expect(dup.res.status).toBe(409);
  });
});

describe("S63 only an Owner invites, and authority roles need the password again", () => {
  it("a payment approver (not an Owner) cannot invite or revoke", async () => {
    const pay = (await cookieFor(a.payment)).cookie;
    expect((await invite(a, email(), ["VIEWER"], pay)).res.status).toBe(403);
    const mine = (await invite(a, email(), ["VIEWER"])).body;
    expect((await call(revokeRoute, { cookie: pay }, withId(mine.id))).status).toBe(403);
  });

  it("payroll or payment roles without the right password -> 401; with it -> 200", async () => {
    for (const roles of [["PAYROLL_APPROVER"], ["PAYMENT_APPROVER", "VIEWER"]]) {
      expect((await invite(a, email(), roles)).res.status).toBe(401);
      expect((await invite(a, email(), roles, owner, "wrong-password")).res.status).toBe(401);
    }
    expect((await invite(a, email(), ["PAYMENT_APPROVER"], owner, a.payroll.password)).res.status).toBe(200);
    expect((await invite(a, email(), ["VIEWER", "HR_APPROVER"])).res.status).toBe(200); // HR_APPROVER widens nothing by itself
  });

  it("an Owner cannot revoke another company's invite", async () => {
    const theirs = await issueInvite({ companyId: b.id, email: email(), roles: ["VIEWER"], issuer: "OWNER", issuedBy: b.payroll.id, correlationId: randomUUID() });
    expect((await call(revokeRoute, { cookie: owner }, withId(theirs.id))).status).toBe(404);
    expect(await peekInvite(theirs.token)).not.toBeNull();
  });

  it("invites cannot be edited or deleted, even by the service role", async () => {
    const i = await issueInvite({ companyId: a.id, email: email(), roles: ["VIEWER"], issuer: "OWNER", issuedBy: a.payroll.id, correlationId: randomUUID() });
    expect((await admin.from("invites").update({ roles: ["OWNER"] }).eq("id", i.id)).error).not.toBeNull();
    expect((await admin.from("invites").update({ email: email() }).eq("id", i.id)).error).not.toBeNull();
    expect((await admin.from("invites").delete().eq("id", i.id)).error).not.toBeNull();
  });
});

describe("S64 access approval and sandboxes", () => {
  async function contact(company: string | null = "Acme Test Ltd") {
    const e = email();
    const row = await admin.schema("growth").from("contacts").insert({ email: e, company_name: company, consent_version: "test", consented_at: new Date().toISOString(), is_test: true }).select("id").single();
    expect(row.error).toBeNull();
    return { id: row.data!.id as string, email: e };
  }

  it("approval creates a company with an Owner invite for the contact, once", async () => {
    const c = await contact();
    const adminId = randomUUID();
    const r = (await approveAccess(c.id, adminId, false, randomUUID()))!;
    const co = (await admin.from("companies").select("name, is_sandbox, is_demo, live_payments_enabled").eq("id", r.companyId).single()).data!;
    expect(co).toMatchObject({ name: "Acme Test Ltd", is_sandbox: false, live_payments_enabled: false });
    const view = (await peekInvite(tokenOf(r.link)))!;
    expect(view).toMatchObject({ email: c.email, roles: ["OWNER"], companyId: r.companyId });
    await expect(approveAccess(c.id, adminId, false, randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });

    // accepting it makes the person the company's Owner
    expect((await accept(tokenOf(r.link), PASSWORD())).status).toBe(200);
    expect((await admin.from("memberships").select("roles").eq("company_id", r.companyId).eq("email", c.email).single()).data!.roles).toEqual(["OWNER"]);
    expect(await approveAccess(randomUUID(), adminId, false, randomUUID())).toBeNull();
  });

  it("after a revoke the empty company is reused instead of creating another", async () => {
    const c = await contact();
    const adminId = randomUUID();
    const first = (await approveAccess(c.id, adminId, false, randomUUID()))!;
    const inv = (await admin.from("invites").select("id").eq("lead_id", c.id).single()).data!;
    await revokeInvite(first.companyId, inv.id, adminId, randomUUID());
    const again = (await approveAccess(c.id, adminId, false, randomUUID()))!;
    expect(again.companyId).toBe(first.companyId);
    expect(await peekInvite(tokenOf(first.link))).toBeNull();
    expect(await peekInvite(tokenOf(again.link))).not.toBeNull();
  });

  it("a sandbox company can never switch live payments on, and neither can the demo company", async () => {
    const r = (await approveAccess((await contact("Judge Sandbox")).id, randomUUID(), true, randomUUID()))!;
    expect((await admin.from("companies").select("is_sandbox").eq("id", r.companyId).single()).data!.is_sandbox).toBe(true);
    expect((await admin.from("companies").update({ live_payments_enabled: true }).eq("id", r.companyId)).error).not.toBeNull();
    const demo = await admin.from("companies").insert({ name: "dbtest-demo", is_demo: true, live_payments_enabled: true });
    expect(demo.error).not.toBeNull();
  });

  it("a second company can join an existing login (one login, many companies)", async () => {
    const c = await contact();
    const r = (await approveAccess(c.id, randomUUID(), false, randomUUID()))!;
    const existing = b.payment;
    await joinCompany(existing, r.companyId, ["VIEWER"]);
    expect(((await admin.from("memberships").select("company_id").eq("user_id", existing.id)).data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
