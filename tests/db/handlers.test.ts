// S13 IDOR, S14 authz + strict bodies, S17 Origin, S43 MFA enforced by the handler guard. Real handlers, real sessions.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createRunRoute } from "@/app/api/runs/route";
import { POST as compensationRoute } from "@/app/api/workers/[id]/compensation/route";
import { POST as walletRoute } from "@/app/api/workers/[id]/wallet/route";
import { POST as createWorkerRoute } from "@/app/api/workers/route";
import { activeConfig, admin, call, cookieFor, makeCompany, withId, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let cookieA: string;
let cookiePay: string;
let workerB: string;
let seq = 0;
const good = () => ({ pseudonym: `W${Date.now() % 100000}${seq++}`.padEnd(6, "0"), payType: "SALARIED", baseAmount: "1000" });

beforeAll(async () => {
  a = await makeCompany({ live: true });
  b = await makeCompany({ live: true });
  await activeConfig(a); // runs need an active configuration
  cookieA = (await cookieFor(a.payroll)).cookie;
  cookiePay = (await cookieFor(a.payment)).cookie;
  const cookieB = (await cookieFor(b.payroll)).cookie;
  const res = await call(createWorkerRoute, { cookie: cookieB, body: good() });
  expect(res.status).toBe(200);
  workerB = (await res.json()).id;
});

describe("S14 session decides company and role; strict bodies", () => {
  it("unauthenticated -> 401", async () => {
    expect((await call(createWorkerRoute, { body: good() })).status).toBe(401);
  });
  it("wrong role -> 403", async () => {
    expect((await call(createWorkerRoute, { cookie: cookiePay, body: good() })).status).toBe(403);
  });
  it("forged company_id, role, state or amount fields -> 400, nothing written", async () => {
    for (const extra of [{ company_id: b.id }, { role: "PAYMENT_APPROVER" }, { status: "APPROVED" }, { amount: "5" }]) {
      const body = { ...good(), ...extra };
      const res = await call(createWorkerRoute, { cookie: cookieA, body });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect((await admin.from("workers").select("id").eq("pseudonym", body.pseudonym)).data ?? []).toEqual([]);
    }
  });
  it("a valid create lands in the session's company", async () => {
    const res = await call(createWorkerRoute, { cookie: cookieA, body: good() });
    expect(res.status).toBe(200);
    const row = (await admin.from("workers").select("company_id").eq("id", (await res.json()).id).single()).data!;
    expect(row.company_id).toBe(a.id);
  });
  it("a run cannot choose its state, and defaults to SIMULATION in the session's company", async () => {
    const bad = await call(createRunRoute, { cookie: cookieA, body: { periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "APPROVED" } });
    expect(bad.status).toBe(400);
    const ok = await call(createRunRoute, { cookie: cookieA, body: { periodStart: "2026-11-01", periodEnd: "2026-11-30" } });
    expect(ok.status).toBe(200);
    const created = await ok.json();
    const run = (await admin.from("payroll_runs").select("mode, status, company_id").eq("id", created.id ?? created.runId).single()).data!;
    expect(run).toMatchObject({ mode: "SIMULATION", status: "DRAFT", company_id: a.id });
  });
});

describe("S13 IDOR", () => {
  it("company A cannot add a compensation version to company B's worker (404, nothing written)", async () => {
    const res = await call(compensationRoute, { cookie: cookieA, body: { baseAmount: "1", reason: "RAISE" } }, withId(workerB));
    expect(res.status).toBe(404);
    expect((await admin.from("compensations").select("version").eq("worker_id", workerB)).data ?? []).toHaveLength(1);
  });
  it("company A cannot provision a wallet for company B's worker (404)", async () => {
    expect((await call(walletRoute, { cookie: cookieA }, withId(workerB))).status).toBe(404);
    expect((await admin.from("workers").select("wallet_id").eq("id", workerB).single()).data!.wallet_id).toBeNull();
  });
  it("a malformed or unknown id -> 404, not 500", async () => {
    expect((await call(compensationRoute, { cookie: cookieA, body: { baseAmount: "1", reason: "RAISE" } }, withId("not-a-uuid"))).status).toBe(404);
    expect((await call(compensationRoute, { cookie: cookieA, body: { baseAmount: "1", reason: "RAISE" } }, withId("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
  });
});

describe("S17 Origin", () => {
  it("a missing or foreign Origin on a mutation -> 403", async () => {
    expect((await call(createWorkerRoute, { cookie: cookieA, body: good(), origin: null })).status).toBe(403);
    expect((await call(createWorkerRoute, { cookie: cookieA, body: good(), origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("S43 handler guard", () => {
  it("a password-only session in an MFA company -> 401 MFA_REQUIRED on mutations", async () => {
    const m = await makeCompany({ live: false, mfa: true });
    const { cookie } = await cookieFor(m.payroll);
    const res = await call(createWorkerRoute, { cookie, body: good() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("MFA_REQUIRED");
  });
});
