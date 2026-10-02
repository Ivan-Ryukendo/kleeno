// S44: deletion on request removes every row and the wrapped data key of one company, and nothing of another.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { parseUsdc } from "@/core/money";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { reconcileRun } from "@/server/db/reconciliation";
import { createWorker } from "@/server/db/workers";
import { admin, makeCompany, userClient, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
const off = { name: "fake", complete: async () => { throw new Error("off"); } };

async function populate(c: TestCompany) {
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [], varianceTolerance: "0.01", rules: [{ ruleId: "BASE_SALARY" as const, clauseIds: ["C1"] }] };
  const draft = await createConfigDraft(who(c), { params, clauses: [{ id: "C1", text: "policy text" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(who(c), draft.id, act);
  await createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: "W501", payType: "SALARIED", compensation: { baseAmount: parseUsdc("2000"), hourlyRate: 0n } });
  const run = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: draft.version, created_by: c.payroll.id }).select("id").single()).data!.id;
  await importRows(who(c), { runId: run, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items: [{ row: 2, data: { workerRef: "W501", date: "2026-10-05", hours: "8" } }] });
  await reconcileRun(who(c), run, off); // raises the missing-hours exception and writes an AI execution
}

const tablesWithCompany = async () => ((await admin.rpc("security_inventory")).data as { table_name: string; has_company_id: boolean }[]).filter((t) => t.has_company_id && t.table_name !== "companies").map((t) => t.table_name);
const count = async (table: string, company: string) => (await admin.from(table).select("*", { count: "exact", head: true }).eq("company_id", company)).count ?? 0;

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  await populate(a);
  await populate(b);
});

describe("delete_company", () => {
  it("leaves no row, no wrapped key and no company behind, and touches nobody else", async () => {
    const tables = await tablesWithCompany();
    let beforeA = 0;
    let beforeB = 0;
    for (const t of tables) {
      beforeA += await count(t, a.id);
      beforeB += await count(t, b.id);
    }
    expect(beforeA).toBeGreaterThan(15); // the data really was there, including immutable rows (audit, executions, evidence)
    expect(await count("company_keys", a.id)).toBe(1);

    const res = await admin.rpc("delete_company", { p_company: a.id });
    expect(res.error).toBeNull();
    expect(Object.values(res.data as Record<string, number>).reduce((s, n) => s + Number(n), 0)).toBe(beforeA);

    for (const t of tables) expect(await count(t, a.id), t).toBe(0);
    expect((await admin.from("companies").select("id").eq("id", a.id)).data).toEqual([]);
    let afterB = 0;
    for (const t of tables) afterB += await count(t, b.id);
    expect(afterB).toBe(beforeB);
  });

  it("the triggers are back afterwards: evidence and audit are immutable again", async () => {
    const ev = (await admin.from("timesheets").select("id").eq("company_id", b.id).limit(1).single()).data!;
    expect((await admin.from("timesheets").update({ hours: 1 }).eq("id", ev.id)).error).not.toBeNull();
    const au = (await admin.from("audit_events").select("id").eq("company_id", b.id).limit(1).single()).data!;
    expect((await admin.from("audit_events").delete().eq("id", au.id)).error).not.toBeNull();
  });

  it("an unknown company is an error, and no public role can call it", async () => {
    expect((await admin.rpc("delete_company", { p_company: randomUUID() })).error).not.toBeNull();
    const user = await userClient(b.payroll);
    expect((await user.rpc("delete_company", { p_company: b.id })).error).not.toBeNull();
    expect((await admin.from("companies").select("id").eq("id", b.id)).data).toHaveLength(1);
  });
});
