// S61 memberships and the active company, S63 (roles, last Owner, four-eyes with several roles), S65 (switching).
// One login in two companies: every read, route and RLS check sees only the active company; forged or stale values get nothing.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as switchRoute } from "@/app/api/companies/switch/route";
import { POST as queryRoute } from "@/app/api/views/query/route";
import { batchMachine, type BatchState } from "@/core/domain/machines";
import { defaultView } from "@/core/views";
import { COMPANY_COOKIE, signCompany } from "@/server/auth/company";
import { createWorker } from "@/server/db/workers";
import { dbStore } from "@/server/db/store";
import { parseUsdc } from "@/core/money";
import { admin, approvedRun, call, cookieFor, joinCompany, makeCompany, proposedBatch, step, userClient, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let c: TestCompany; // a company the shared user does not belong to
let session: string;
const batches = dbStore<BatchState>("payment_batches");
const withCompany = (id: string | null, raw?: string) => (id || raw ? `${session}; ${COMPANY_COOKIE}=${raw ?? signCompany(id!)}` : session);
const workerCount = async (cookie: string) => (await (await call(queryRoute, { cookie, body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } })).json()).total as number;
const worker = (co: TestCompany, n: number) => createWorker({ companyId: co.id, userId: co.payroll.id, correlationId: randomUUID() }, { pseudonym: `W${900 + n}`, payType: "SALARIED", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: 0n } });

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  c = await makeCompany();
  await joinCompany(a.payroll, b.id, ["PAYROLL_APPROVER"]); // the same login works in both companies
  await worker(a, 1);
  await worker(b, 1);
  await worker(b, 2);
  session = (await cookieFor(a.payroll)).cookie;
});

describe("S61 the active company", () => {
  it("shows only the active company's rows, and switching changes everything", async () => {
    expect(await workerCount(withCompany(a.id))).toBe(1);
    expect(await workerCount(withCompany(b.id))).toBe(2);
  });

  it("a user with several companies and no valid choice gets 403, never a default", async () => {
    const res = await call(queryRoute, { cookie: withCompany(null), body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NO_COMPANY");
  });

  it("a forged, tampered or foreign company value gets 403", async () => {
    const real = signCompany(b.id);
    for (const raw of ["garbage", b.id, `${b.id}.AAAA`, `${real.slice(0, -2)}xx`, signCompany(c.id)]) {
      const res = await call(queryRoute, { cookie: withCompany(null, raw), body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } });
      expect(res.status, raw).toBe(403);
    }
  });

  it("a user with exactly one company needs no choice", async () => {
    const solo = (await cookieFor(c.payroll)).cookie;
    expect((await call(queryRoute, { cookie: solo, body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } })).status).toBe(200);
  });

  it("RLS follows the header: the chosen company only, nothing without a choice, nothing for a company you are not in", async () => {
    const own = async (company?: string) => ((await (await userClient(a.payroll, company)).from("workers").select("company_id")).data ?? []).map((r: { company_id: string }) => r.company_id);
    expect(new Set(await own(a.id))).toEqual(new Set([a.id]));
    expect(new Set(await own(b.id))).toEqual(new Set([b.id]));
    expect(await own()).toEqual([]); // two memberships and no header
    expect(await own(c.id)).toEqual([]);
  });

  it("a removed member loses access at the next request, in handlers and in RLS", async () => {
    await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("user_id", a.payroll.id).eq("company_id", b.id);
    expect((await call(queryRoute, { cookie: withCompany(b.id), body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } })).status).toBe(403);
    expect((((await (await userClient(a.payroll, b.id)).from("workers").select("id")).data) ?? []).length).toBe(0);
    expect(await workerCount(withCompany(a.id))).toBe(1); // company A is unaffected
    await admin.from("memberships").update({ removed_at: null }).eq("user_id", a.payroll.id).eq("company_id", b.id);
  });
});

describe("S65 switching", () => {
  it("switch sets a signed cookie for a company the user belongs to, and refuses any other", async () => {
    const ok = await call(switchRoute, { cookie: session, body: { target: b.id } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie") ?? "").toContain(`${COMPANY_COOKIE}=${encodeURIComponent(signCompany(b.id))}`);
    expect((await call(switchRoute, { cookie: session, body: { target: c.id } })).status).toBe(403);
    expect((await call(switchRoute, { cookie: session, body: { target: b.id, company_id: c.id } })).status).toBe(400);
    expect((await call(switchRoute, { body: { target: b.id } })).status).toBe(401);
  });

  it("after a switch, an id from the old company is not found (rows of the other company never show)", async () => {
    const listed = async (cookie: string) => ((await (await call(queryRoute, { cookie, body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null } })).json()).rows as { code: string }[]).map((r) => r.code);
    expect(await listed(withCompany(a.id))).toEqual(["W901"]);
    expect((await listed(withCompany(b.id))).sort()).toEqual(["W901", "W902"]);
  });
});

describe("S63 roles", () => {
  it("a member holding payroll and payment roles still cannot authorize payment for a run they approved", async () => {
    const co = await makeCompany({ live: true });
    await admin.from("memberships").update({ roles: ["OWNER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] }).eq("user_id", co.payroll.id).eq("company_id", co.id);
    const run = await approvedRun(co);
    const self = await proposedBatch(co, run, co.payroll.id);
    await expect(step(batches, batchMachine, co, self, ["authorize"])).rejects.toThrow();
    const other = await proposedBatch(co, run, co.payment.id);
    await step(batches, batchMachine, co, other, ["authorize"]);
  });

  it("a removed member can no longer authorize payment", async () => {
    const co = await makeCompany({ live: true });
    const run = await approvedRun(co);
    await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("user_id", co.payment.id).eq("company_id", co.id);
    const removed = await proposedBatch(co, run, co.payment.id);
    await expect(step(batches, batchMachine, co, removed, ["authorize"])).rejects.toThrow();
  });

  it("the last Owner can be neither removed nor demoted; memberships are never deleted or moved", async () => {
    const co = await makeCompany();
    const owner = (patch: Record<string, unknown>) => admin.from("memberships").update(patch).eq("user_id", co.payroll.id).eq("company_id", co.id);
    expect((await owner({ removed_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await owner({ roles: ["PAYROLL_APPROVER"] })).error).not.toBeNull();
    expect((await owner({ company_id: a.id })).error).not.toBeNull();
    expect((await admin.from("memberships").delete().eq("user_id", co.payroll.id).eq("company_id", co.id)).error).not.toBeNull();
    // a second Owner makes the first removable
    await admin.from("memberships").update({ roles: ["OWNER", "PAYMENT_APPROVER"] }).eq("user_id", co.payment.id).eq("company_id", co.id);
    expect((await owner({ roles: ["PAYROLL_APPROVER"] })).error).toBeNull();
  });

  it("a user cannot write memberships through the public API", async () => {
    const ua = await userClient(a.payroll, a.id);
    expect((await ua.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", a.id).select("user_id")).data ?? []).toEqual([]);
    expect((await ua.from("memberships").insert({ user_id: a.payroll.id, company_id: c.id, roles: ["OWNER"] })).error).not.toBeNull();
    expect((((await ua.from("memberships").select("company_id")).data ?? []) as { company_id: string }[]).every((r) => r.company_id === a.id || r.company_id === b.id)).toBe(true);
  });
});
