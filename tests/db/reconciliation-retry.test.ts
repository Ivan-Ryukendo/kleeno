// R3.2: a run stranded in RECONCILING (read failed after start_reconciliation committed) resumes through the state machine.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { runMachine } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { TransitionError } from "@/core/domain/machines";
import { parseUsdc } from "@/core/money";
import { WorkflowError } from "@/core/workflow";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { reconcileRun, retryReconciliation } from "@/server/db/reconciliation";
import { runStore } from "@/server/db/runs";
import { createWorker } from "@/server/db/workers";
import { admin, makeCompany, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany, roles = c.payroll.roles) => ({ companyId: c.id, userId: c.payroll.id, roles, correlationId: randomUUID() });
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const off = {
  name: "off",
  async complete(): Promise<never> {
    throw new Error("AI unavailable");
  },
};
const move = (c: TestCompany, id: string, action: string) => applyTransition(runStore, runMachine, { id, companyId: c.id, action, actor: "t", actorType: "script", correlationId: randomUUID() });

/** A run whose first pass died after start_reconciliation committed: exactly the stranded state. */
async function stranded(c: TestCompany, version: number, hours: string[]) {
  const runId = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: version, created_by: c.payroll.id }).select("id").single()).data!.id as string;
  const rows = DAYS.map((d, i) => ({ workerRef: "W201", date: d, hours: hours[i] })).filter((r) => r.hours !== "0");
  await importRows(who(c), { runId, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items: rows.map((data, i) => ({ row: i + 2, data })) });
  await move(c, runId, "start_reconciliation");
  return runId;
}
const statusOf = async (id: string) => (await admin.from("payroll_runs").select("status").eq("id", id).single()).data!.status as string;
const exceptionsOf = async (id: string) => (await admin.from("exceptions").select("category, status").eq("run_id", id)).data!;
const auditCount = async (id: string, event: string) => ((await admin.from("audit_events").select("id").eq("entity_id", id).eq("event", event)).data ?? []).length;

let version: number;
beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [], varianceTolerance: "0.01", rules: [{ ruleId: "BASE_SALARY" as const, clauseIds: ["C1"] }] };
  const draft = await createConfigDraft(who(a), { params, clauses: [{ id: "C1", text: "policy" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(who(a), draft.id, act);
  version = draft.version;
  await createWorker({ companyId: a.id, userId: a.payroll.id, correlationId: randomUUID() }, { pseudonym: "W201", payType: "SALARIED", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: parseUsdc("20") } });
}, 120_000);

describe("retryReconciliation", () => {
  it("a clean stranded run resumes to READY_FOR_CALCULATION with no exceptions, audited once", async () => {
    const id = await stranded(a, version, ["8", "8", "8", "8", "8"]);
    expect(await statusOf(id)).toBe("RECONCILING");
    await expect(reconcileRun(who(a), id, off)).rejects.toBeInstanceOf(TransitionError); // the first pass is not a retry
    expect(await retryReconciliation(who(a), id, off)).toMatchObject({ status: "READY_FOR_CALCULATION", resumed: true });
    expect(await statusOf(id)).toBe("READY_FOR_CALCULATION");
    expect(await exceptionsOf(id)).toEqual([]);
    expect(await auditCount(id, "reconciliation.retry")).toBe(1);
  }, 120_000);

  it("a stranded run with a gap resumes to EXCEPTIONS_PENDING with exactly the expected exception; repeats change nothing", async () => {
    const id = await stranded(a, version, ["8", "8", "8", "8", "0"]);
    expect(await retryReconciliation(who(a), id, off)).toMatchObject({ status: "EXCEPTIONS_PENDING", open: 1 });
    expect((await exceptionsOf(id)).map((e) => [e.category, e.status])).toEqual([["UNEXPLAINED_MISSING_HOURS", "OPEN"]]);
    expect(await retryReconciliation(who(a), id, off)).toMatchObject({ status: "EXCEPTIONS_PENDING", resumed: false });
    expect(await exceptionsOf(id)).toHaveLength(1);
    expect(await auditCount(id, "run.raise_exceptions")).toBe(1);
    expect(await auditCount(id, "reconciliation.retry")).toBe(1);
  }, 120_000);

  it("concurrent retries: one transition, no duplicate exceptions, every caller gets an answer", async () => {
    const id = await stranded(a, version, ["8", "8", "8", "8", "0"]);
    const r = await Promise.allSettled([retryReconciliation(who(a), id, off), retryReconciliation(who(a), id, off), retryReconciliation(who(a), id, off)]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await statusOf(id)).toBe("EXCEPTIONS_PENDING");
    expect(await exceptionsOf(id)).toHaveLength(1);
    expect(await auditCount(id, "run.raise_exceptions")).toBe(1);
  }, 120_000);

  it("keeps role and company checks; refuses runs that are not stranded", async () => {
    const id = await stranded(a, version, ["8", "8", "8", "8", "8"]);
    await expect(retryReconciliation(who(a, ["PAYMENT_APPROVER"]), id, off)).rejects.toBeInstanceOf(WorkflowError);
    await expect(retryReconciliation(who(b), id, off)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await statusOf(id)).toBe("RECONCILING");
    const draft = (await admin.from("payroll_runs").insert({ company_id: a.id, mode: "SIMULATION", period_start: "2026-11-02", period_end: "2026-11-08", config_version: version, created_by: a.payroll.id }).select("id").single()).data!.id as string;
    await expect(retryReconciliation(who(a), draft, off)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  }, 120_000);
});
