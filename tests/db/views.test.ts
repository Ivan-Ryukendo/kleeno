// S59 views, S60 export, S13 isolation, S14 strict bodies: real handlers, real sessions, real RLS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as exportRoute } from "@/app/api/views/export/route";
import { POST as queryRoute } from "@/app/api/views/query/route";
import { parseUsdc } from "@/core/money";
import { defaultView, type ViewDef } from "@/core/views";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { createWorker } from "@/server/db/workers";
import { admin, call, cookieFor, makeCompany, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let cookieA: string;
let cookieB: string;
let cookiePay: string;
let runId: string;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
const q = (cookie: string | undefined, view: ViewDef | object, run: string | null = runId) => call(queryRoute, { cookie, body: { view, runId: run } });

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [], varianceTolerance: "0.01", rules: [{ ruleId: "BASE_SALARY" as const, clauseIds: ["C1"] }] };
  const draft = await createConfigDraft(who(a), { params, clauses: [{ id: "C1", text: "policy" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(who(a), draft.id, act);
  for (const [code, base] of [["W401", "2000"], ["W402", "1500"]]) await createWorker({ companyId: a.id, userId: a.payroll.id, correlationId: randomUUID() }, { pseudonym: code, payType: "SALARIED", compensation: { baseAmount: parseUsdc(base), hourlyRate: 0n } });
  runId = (await admin.from("payroll_runs").insert({ company_id: a.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: draft.version, created_by: a.payroll.id }).select("id").single()).data!.id;
  await importRows(who(a), { runId, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items: [["W401", "2026-10-05", "8"], ["W401", "2026-10-06", "9"], ["W402", "2026-10-05", "7.5"]].map(([w, d, h], i) => ({ row: i + 2, data: { workerRef: w, date: d, hours: h } })) });
  cookieA = (await cookieFor(a.payroll)).cookie;
  cookiePay = (await cookieFor(a.payment)).cookie;
  cookieB = (await cookieFor(b.payroll)).cookie;
});

describe("query", () => {
  it("returns only the rows of the session's company, with match status, totals and counts", async () => {
    const res = await q(cookieA, { ...defaultView("timesheets", ["PAYROLL_APPROVER"]), sort: { column: "hours", dir: "desc" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.rows.map((r: { hours: string }) => r.hours)).toEqual(["9", "8", "7.5"]);
    expect(body.rows.every((r: { match: string }) => r.match === "AUTO_MATCHED")).toBe(true);
    expect(body.columns.map((c: { id: string }) => c.id)).toEqual(["worker", "date", "hours", "approvedExtra", "match"]);
  });

  it("filters on the server and projects only the requested columns", async () => {
    const body = await (await q(cookieA, { ...defaultView("timesheets", ["PAYROLL_APPROVER"]), columns: ["worker", "hours"], filters: [{ column: "hours", op: "gte", value: "8" }] })).json();
    expect(body.total).toBe(2);
    expect(Object.keys(body.rows[0]).sort()).toEqual(["hours", "worker"]);
  });

  it("workers table: pay columns come back for payroll roles", async () => {
    const body = await (await q(cookieA, defaultView("workers", ["PAYROLL_APPROVER"]), null)).json();
    expect(body.total).toBe(2);
    expect(body.totals).toEqual({ base: "3500.00" });
  });

  it("S13: another company's run is the same as a missing run; its workers never appear", async () => {
    expect((await q(cookieB, defaultView("timesheets", ["PAYROLL_APPROVER"]))).status).toBe(400);
    expect((await (await q(cookieB, defaultView("workers", ["PAYROLL_APPROVER"]), null)).json()).total).toBe(0);
  });

  it("S14/S59: unauthenticated -> 401; forged fields, unknown tables and SQL in columns -> 400", async () => {
    expect((await q(undefined, defaultView("timesheets", ["PAYROLL_APPROVER"]))).status).toBe(401);
    for (const bad of [{ ...defaultView("timesheets", ["PAYROLL_APPROVER"]), sql: "select 1" }, { ...defaultView("timesheets", ["PAYROLL_APPROVER"]), table: "app_users" }, { ...defaultView("timesheets", ["PAYROLL_APPROVER"]), columns: ["worker; drop table workers"] }])
      expect((await q(cookieA, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await call(queryRoute, { cookie: cookieA, body: { view: defaultView("workers", ["PAYROLL_APPROVER"]), runId: null, company_id: b.id } })).status).toBe(400);
  });

  it("a run-scoped table needs a run", async () => {
    expect((await q(cookieA, defaultView("timesheets", ["PAYROLL_APPROVER"]), null)).status).toBe(400);
  });
});

describe("S60 export", () => {
  it("is a no-store CSV of the view, audited without values", async () => {
    const res = await call(exportRoute, { cookie: cookieA, body: { view: { ...defaultView("timesheets", ["PAYROLL_APPROVER"]), columns: ["worker", "hours"] }, runId } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toBe("Worker,Hours\r\nW401,8\r\nW401,9\r\nW402,7.5\r\n");
    const ev = (await admin.from("audit_events").select("refs, actor").eq("company_id", a.id).eq("event", "view.export")).data!;
    expect(ev).toHaveLength(1);
    expect(ev[0].refs).toEqual({ table: "timesheets", rows: 3 });
  });

  it("another company cannot export this run; unauthenticated is refused", async () => {
    expect((await call(exportRoute, { cookie: cookieB, body: { view: defaultView("timesheets", ["PAYROLL_APPROVER"]), runId } })).status).toBe(400);
    expect((await call(exportRoute, { body: { view: defaultView("timesheets", ["PAYROLL_APPROVER"]), runId } })).status).toBe(401);
  });

  it("the payment approver can read the company's tables too (both roles view everything)", async () => {
    expect((await call(queryRoute, { cookie: cookiePay, body: { view: defaultView("workers", ["PAYMENT_APPROVER"]), runId: null } })).status).toBe(200);
  });
});
