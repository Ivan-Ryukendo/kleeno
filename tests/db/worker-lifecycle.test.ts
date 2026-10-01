// Worker lifecycle: promotion = new immutable version, leaving = archive (never delete), reactivation; isolation and roles.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as archiveRoute } from "@/app/api/workers/[id]/archive/route";
import { POST as compensationRoute } from "@/app/api/workers/[id]/compensation/route";
import { POST as reactivateRoute } from "@/app/api/workers/[id]/reactivate/route";
import { POST as createWorkerRoute } from "@/app/api/workers/route";
import { listWorkers } from "@/server/db/workers";
import { activeConfig, admin, approvedRun, call, cookieFor, makeCompany, userClient, withId, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let cookie: string;
let cookiePay: string;
let cookieB: string;
let id: string;
let seq = 0;

const rows = async () => listWorkers(await userClient(a.payroll), a.id);
const mine = async () => (await rows()).find((w) => w.id === id)!;

beforeAll(async () => {
  a = await makeCompany({ live: true });
  b = await makeCompany({ live: true });
  cookie = (await cookieFor(a.payroll)).cookie;
  cookiePay = (await cookieFor(a.payment)).cookie;
  cookieB = (await cookieFor(b.payroll)).cookie;
  const res = await call(createWorkerRoute, { cookie, body: { pseudonym: `W9${Date.now() % 10000}${seq++}`.padEnd(6, "0"), payType: "SALARIED", baseAmount: "1000" } });
  expect(res.status).toBe(200);
  id = (await res.json()).id;
});

describe("promotion and edits", () => {
  it("a promotion adds a version with its reason and can change the pay type; the old version stays in history", async () => {
    const res = await call(compensationRoute, { cookie, body: { baseAmount: "1500", hourlyRate: "12", payType: "HOURLY", reason: "PROMOTION" } }, withId(id));
    expect(res.status).toBe(200);
    const w = await mine();
    expect(w.payType).toBe("HOURLY");
    expect(w.compensationVersion).toBe(2);
    expect(w.history.map((h) => [h.version, h.reason])).toEqual([[2, "PROMOTION"], [1, "INITIAL"]]);
    expect(w.history[1].baseAmount).toBe(1000_000000n);
  });
  it("a reason is required; unknown fields are rejected", async () => {
    expect((await call(compensationRoute, { cookie, body: { baseAmount: "1" } }, withId(id))).status).toBe(400);
    expect((await call(compensationRoute, { cookie, body: { baseAmount: "1", reason: "RAISE", active: false } }, withId(id))).status).toBe(400);
  });
  it("the payment approver cannot change pay", async () => {
    expect((await call(compensationRoute, { cookie: cookiePay, body: { baseAmount: "1", reason: "RAISE" } }, withId(id))).status).toBe(403);
  });
});

describe("input limits", () => {
  it("an absurd amount or an impossible date is a 400, not a 500", async () => {
    expect((await call(compensationRoute, { cookie, body: { baseAmount: "2000000000", reason: "RAISE" } }, withId(id))).status).toBe(400);
    expect((await call(archiveRoute, { cookie, body: { leftOn: "2026-02-31", reason: "RESIGNED" } }, withId(id))).status).toBe(400);
  });
});

describe("leaving and coming back", () => {
  it("another company cannot archive or reactivate (404)", async () => {
    expect((await call(archiveRoute, { cookie: cookieB, body: { leftOn: "2026-11-30", reason: "RESIGNED" } }, withId(id))).status).toBe(404);
    expect((await call(reactivateRoute, { cookie: cookieB }, withId(id))).status).toBe(404);
  });
  it("needs a date and a known reason", async () => {
    expect((await call(archiveRoute, { cookie, body: { reason: "RESIGNED" } }, withId(id))).status).toBe(400);
    expect((await call(archiveRoute, { cookie, body: { leftOn: "2026-11-30", reason: "BORED" } }, withId(id))).status).toBe(400);
  });
  it("archive keeps the worker and history, drops them from active-only lists, and blocks pay changes", async () => {
    const res = await call(archiveRoute, { cookie, body: { leftOn: "2026-11-30", reason: "RESIGNED" } }, withId(id));
    expect(res.status).toBe(200);
    expect((await res.json()).openObligations).toBe(0);
    const w = await mine();
    expect(w).toMatchObject({ active: false, leftOn: "2026-11-30", leftReason: "RESIGNED" });
    expect(w.history).toHaveLength(2);
    expect((await listWorkers(await userClient(a.payroll), a.id, { activeOnly: true })).some((x) => x.id === id)).toBe(false);
    expect((await call(compensationRoute, { cookie, body: { baseAmount: "1", reason: "RAISE" } }, withId(id))).status).toBe(409);
    expect((await call(archiveRoute, { cookie, body: { leftOn: "2026-12-01", reason: "OTHER" } }, withId(id))).status).toBe(409);
  });
  it("reactivate clears the leaving details", async () => {
    expect((await call(reactivateRoute, { cookie }, withId(id))).status).toBe(200);
    expect(await mine()).toMatchObject({ active: true, leftOn: null, leftReason: null });
    expect((await call(reactivateRoute, { cookie }, withId(id))).status).toBe(409);
  });
  it("a leaver's approved obligation stays untouched and is reported as open (final pay)", async () => {
    const c = await makeCompany({ live: true });
    const r = await approvedRun(c, await activeConfig(c));
    const res = await call(archiveRoute, { cookie: (await cookieFor(c.payroll)).cookie, body: { leftOn: "2026-11-30", reason: "CONTRACT_ENDED" } }, withId(r.workerId));
    expect(res.status).toBe(200);
    expect((await res.json()).openObligations).toBeGreaterThan(0);
    const ob = (await admin.from("obligations").select("status, amount").eq("id", r.obligationId).single()).data!;
    expect(ob.status).toBe("CREATED");
  });
});
