// P4 slice 4: live-payments activation (S66, rule 17): request -> platform approval -> provisioning -> Owner switch (password + TOTP).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as liveRoute } from "@/app/api/company/live-payments/route";
import { sessionClient, type PendingCookie } from "@/server/auth/session";
import type { ProvisionPort } from "@/server/circle/provisioning";
import { decideLive, requestLive, switchLive } from "@/server/db/live-payments";
import { ADDR, admin, call, cookieFor, makeCompany, totp, type TestCompany, type TestUser } from "./helpers";

class FakeProvision implements ProvisionPort {
  wallets = 0;
  deploys = 0;
  failDeploy = false;
  async createWallets() {
    this.wallets++;
    return { approver: { id: randomUUID(), address: ADDR(Math.floor(Math.random() * 1e12)) }, agent: { id: randomUUID(), address: ADDR(Math.floor(Math.random() * 1e12)) } };
  }
  async deployGuard() {
    if (this.failDeploy) throw new Error("circle is down");
    this.deploys++;
    return ADDR(Math.floor(Math.random() * 1e12));
  }
}

const owner = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles }); // payroll user also holds OWNER
const payer = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });
const platformAdmin = { userId: randomUUID() };
const live = async (id: string) => (await admin.from("companies").select("live_status, live_payments_enabled, guard_address").eq("id", id).single()).data!;
const fresh = () => makeCompany(); // NOT_REQUESTED, live off

/** Takes a company all the way to PROVISIONED through the real service. */
async function provisioned() {
  const c = await fresh();
  await requestLive(owner(c));
  await decideLive(platformAdmin, c.id, "approve", undefined, new FakeProvision());
  return c;
}

describe("requesting", () => {
  it("only the Owner can ask; asking twice is refused; a demo or sandbox company can never ask", async () => {
    const c = await fresh();
    await expect(requestLive(payer(c))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await requestLive(owner(c))).toEqual({ status: "REQUESTED" });
    await expect(requestLive(owner(c))).rejects.toThrow();
    const demo = await fresh();
    await admin.from("companies").update({ is_demo: true }).eq("id", demo.id);
    await expect(requestLive(owner(demo))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.from("companies").update({ live_status: "REQUESTED" }).eq("id", demo.id)).error).not.toBeNull(); // the CHECK, behind the service
    const sandbox = await fresh();
    await admin.from("companies").update({ is_sandbox: true }).eq("id", sandbox.id);
    await expect(requestLive(owner(sandbox))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("platform approval and provisioning", () => {
  it("approving creates the wallets and the guard once; approving again changes nothing", async () => {
    const c = await fresh();
    await requestLive(owner(c));
    const port = new FakeProvision();
    expect(await decideLive(platformAdmin, c.id, "approve", undefined, port)).toEqual({ status: "PROVISIONED" });
    const row = await live(c.id);
    expect(row.live_status).toBe("PROVISIONED");
    expect(row.guard_address).toMatch(/^0x[0-9a-f]{40}$/);
    expect((await admin.from("company_wallets").select("role").eq("company_id", c.id)).data!.map((w) => w.role).sort()).toEqual(["AGENT", "APPROVER"]);
    expect(await decideLive(platformAdmin, c.id, "approve", undefined, port)).toEqual({ status: "PROVISIONED" });
    expect([port.wallets, port.deploys]).toEqual([1, 1]);
    expect((await admin.from("audit_events").select("event").eq("company_id", c.id).like("event", "live.%")).data!.map((e) => e.event).sort()).toEqual(["live.approved", "live.provisioned", "live.requested"]);
  });

  it("a provisioning that fails part-way resumes on the next approval without making a second wallet pair", async () => {
    const c = await fresh();
    await requestLive(owner(c));
    const port = new FakeProvision();
    port.failDeploy = true;
    await expect(decideLive(platformAdmin, c.id, "approve", undefined, port)).rejects.toThrow("circle is down");
    expect((await live(c.id)).live_status).toBe("APPROVED");
    port.failDeploy = false;
    expect(await decideLive(platformAdmin, c.id, "approve", undefined, port)).toEqual({ status: "PROVISIONED" });
    expect([port.wallets, port.deploys]).toEqual([1, 1]);
  });

  it("a rejected company can ask again; a company that never asked cannot be approved", async () => {
    const c = await fresh();
    await expect(decideLive(platformAdmin, c.id, "approve", undefined, new FakeProvision())).rejects.toThrow();
    await requestLive(owner(c));
    expect(await decideLive(platformAdmin, c.id, "reject")).toEqual({ status: "REJECTED" });
    expect(await requestLive(owner(c))).toEqual({ status: "REQUESTED" });
  });

  it("the database refuses skipped steps, an incomplete provisioning, and switching ON before the company is provisioned", async () => {
    const c = await fresh();
    expect((await admin.from("companies").update({ live_status: "PROVISIONED" }).eq("id", c.id)).error).not.toBeNull(); // NOT_REQUESTED -> PROVISIONED
    await requestLive(owner(c));
    expect((await admin.from("companies").update({ live_status: "PROVISIONED" }).eq("id", c.id)).error).not.toBeNull(); // REQUESTED -> PROVISIONED
    await admin.from("companies").update({ live_status: "APPROVED" }).eq("id", c.id);
    expect((await admin.from("companies").update({ live_status: "PROVISIONED" }).eq("id", c.id)).error).not.toBeNull(); // no wallets, no guard
    expect((await admin.from("companies").update({ live_payments_enabled: true }).eq("id", c.id)).error).not.toBeNull(); // not provisioned
    expect((await live(c.id)).live_payments_enabled).toBe(false);
  });
});

describe("switching live payments", () => {
  it("ON needs a provisioned company and two people with the two roles; OFF is always allowed to the Owner or a payment approver", async () => {
    const c = await fresh();
    await expect(switchLive(owner(c), true)).rejects.toMatchObject({ code: "NOT_PROVISIONED" });
    const p = await provisioned();
    await expect(switchLive(payer(p), true)).rejects.toMatchObject({ code: "FORBIDDEN" }); // only the Owner
    expect(await switchLive(owner(p), true)).toEqual({ enabled: true });
    expect((await live(p.id)).live_payments_enabled).toBe(true);
    expect(await switchLive(payer(p), false)).toEqual({ enabled: false });
    await expect(switchLive({ ...owner(p), roles: ["VIEWER"] }, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.from("audit_events").select("refs").eq("company_id", p.id).eq("event", "LIVE_PAYMENTS_SWITCHED").order("created_at")).data!.map((e) => e.refs.enabled)).toEqual([true, false]);
  });

  it("without a different payment approver it is refused by the service and by the database", async () => {
    const p = await provisioned();
    await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("user_id", p.payment.id).eq("company_id", p.id);
    await expect(switchLive(owner(p), true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.from("companies").update({ live_payments_enabled: true }).eq("id", p.id)).error).not.toBeNull();
    await admin.from("memberships").update({ removed_at: null }).eq("user_id", p.payment.id).eq("company_id", p.id);
    expect((await admin.from("companies").update({ live_payments_enabled: true }).eq("id", p.id)).error).toBeNull();
  });
});

/** A session that has enrolled and verified an authenticator, so its cookie is aal2, plus the secret to make fresh codes. */
async function aal2(u: TestUser) {
  const sink: PendingCookie[] = [];
  const client = sessionClient([], sink);
  await client.auth.signInWithPassword({ email: u.email, password: u.password });
  const enrol = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `t-${Date.now()}` });
  await client.auth.mfa.challengeAndVerify({ factorId: enrol.data!.id, code: totp(enrol.data!.totp.secret) });
  const latest = new Map(sink.map((c) => [c.name, c.value]));
  return { cookie: [...latest].map(([n, v]) => `${n}=${v}`).join("; "), secret: enrol.data!.totp.secret };
}

describe("S66 the Owner's switch on the route", () => {
  const path = "/api/company/live-payments";

  it("switching ON needs the password and a fresh authenticator code in the same request", async () => {
    const p = await provisioned();
    const { cookie: plain } = await cookieFor(p.payroll);
    expect((await call(liveRoute, { cookie: plain, path, body: { action: "switch_on" } })).status).toBe(400); // strict body: password and code are required
    expect((await call(liveRoute, { cookie: plain, path, body: { action: "switch_on", password: "wrong", code: "123456" } })).status).toBe(401);
    const noFactor = await call(liveRoute, { cookie: plain, path, body: { action: "switch_on", password: p.payroll.password, code: "123456" } });
    expect(noFactor.status).toBe(401); // right password, but no authenticator set up
    expect((await live(p.id)).live_payments_enabled).toBe(false);

    const s = await aal2(p.payroll);
    const next = (offset: number) => totp(s.secret, Date.now() + offset * 30_000);
    expect((await call(liveRoute, { cookie: s.cookie, path, body: { action: "switch_on", password: p.payroll.password, code: "000000" } })).status).toBe(401); // wrong code
    expect((await live(p.id)).live_payments_enabled).toBe(false);
    const ok = await call(liveRoute, { cookie: s.cookie, path, body: { action: "switch_on", password: p.payroll.password, code: next(1) } });
    expect(ok.status).toBe(200);
    expect((await live(p.id)).live_payments_enabled).toBe(true);
  });

  it("a payment approver can switch OFF without re-auth but cannot request or switch ON", async () => {
    const p = await provisioned();
    await admin.from("companies").update({ live_payments_enabled: true }).eq("id", p.id);
    const { cookie } = await cookieFor(p.payment);
    expect((await call(liveRoute, { cookie, path, body: { action: "request" } })).status).toBe(403);
    expect((await call(liveRoute, { cookie, path, body: { action: "switch_on", password: p.payment.password, code: "123456" } })).status).toBe(403);
    expect((await call(liveRoute, { cookie, path, body: { action: "switch_off" } })).status).toBe(200);
    expect((await live(p.id)).live_payments_enabled).toBe(false);
  });
});
