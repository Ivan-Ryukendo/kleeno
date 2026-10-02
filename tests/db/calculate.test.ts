// P3 slice 4: calculate from the reconciled snapshot. Rule 14 (nothing opens early), rule 17 (SIMULATION stops here), rule 9 (same
// inputs, same hash), S46/S48 (snapshot references immutable evidence), S41 (variance amounts encrypted), S13 isolation.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AiProvider } from "@/core/ai";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { formatUsdc, parseUsdc } from "@/core/money";
import { WorkflowError } from "@/core/workflow";
import { openJson } from "@/server/crypto";
import { calculateRun } from "@/server/db/calculate";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { reconcileRun, resolveException } from "@/server/db/reconciliation";
import { runStore } from "@/server/db/runs";
import { createWorker } from "@/server/db/workers";
import { admin, makeCompany, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const NOTE = "checked with the team lead";
const noAdvice: AiProvider = { name: "fake", complete: async () => { throw new Error("off"); } }; // suggestions are not under test here

const row = (type: "TIMESHEETS" | "ACTUAL_PAID", data: object[]) => ({ type, items: data.map((d, i) => ({ row: i + 2, data: d })), mapping: (type === "ACTUAL_PAID" ? { workerRef: 0, amount: 1 } : { workerRef: 0, date: 1, hours: 2 }) as Record<string, number> });
const days = (code: string, hours: string[], extra: Record<string, string> = {}) => DAYS.map((date, i) => ({ workerRef: code, date, hours: hours[i], ...extra })).filter((r) => r.hours !== "0");

async function company(c: TestCompany) {
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [{ code: "TAX", label: "Tax", percent: "10" }], varianceTolerance: "0.01", rules: [{ ruleId: "PERCENT_DEDUCTION" as const, clauseIds: ["C1"] }] };
  const w = who(c);
  const draft = await createConfigDraft(w, { params, clauses: [{ id: "C1", text: "tax is 10%" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(w, draft.id, act);
  return draft.version;
}
const worker = (c: TestCompany, code: string, payType: "SALARIED" | "HOURLY" | "RETAINER", base: string, rate: string) =>
  createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: code, payType, compensation: { baseAmount: parseUsdc(base), hourlyRate: parseUsdc(rate) } });
const newRun = async (c: TestCompany, version: number) => (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: version, created_by: c.payroll.id }).select("id").single()).data!.id as string;
const status = async (id: string) => (await admin.from("payroll_runs").select("status").eq("id", id).single()).data!.status as string;

let runId: string;
let ids: Record<string, string>;

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  const version = await company(a);
  ids = {
    S: (await worker(a, "W201", "SALARIED", "2000", "0")).id,
    H: (await worker(a, "W202", "HOURLY", "0", "30")).id,
    R: (await worker(a, "W203", "RETAINER", "1000", "0")).id,
  };
  runId = await newRun(a, version);
  const t = row("TIMESHEETS", [...days("W201", ["8", "8", "8", "8", "0"]), ...days("W202", ["8", "8", "8", "8", "8"]), { workerRef: "W202", date: DAYS[0], hours: "8" }, ...days("W203", ["8", "8", "8", "8", "8"])]);
  await importRows(who(a), { runId, ...t });
  // what the business actually paid: W201 correct, W202 short by 80, W203 never paid
  await importRows(who(a), { runId, ...row("ACTUAL_PAID", [{ workerRef: "W201", amount: "1440" }, { workerRef: "W202", amount: "1000" }]) });
});

describe("calculate", () => {
  it("is refused before reconciliation and while any exception is open (rule 14)", async () => {
    await expect(calculateRun(who(a), runId)).rejects.toBeInstanceOf(TransitionError);
    await reconcileRun(who(a), runId, noAdvice);
    expect(await status(runId)).toBe("EXCEPTIONS_PENDING");
    await expect(calculateRun(who(a), runId)).rejects.toBeInstanceOf(TransitionError);
    expect((await admin.from("calculations").select("id").eq("run_id", runId)).data).toEqual([]);
  });

  it("prices the resolved data in the engine and ends a SIMULATION run at CALCULATION_VALIDATED", async () => {
    const open = async () => (await admin.from("exceptions").select("id, category").eq("run_id", runId).in("status", ["OPEN", "IN_REVIEW"])).data!;
    for (let i = 0; i < 4 && (await open()).length; i++)
      for (const e of await open()) await resolveException(who(a), e.id, { action: e.category === "DUPLICATE_TIMESHEET" ? "KEEP_FIRST" : "TREAT_AS_UNPAID_LEAVE", note: NOTE }, noAdvice);
    expect(await status(runId)).toBe("READY_FOR_CALCULATION");

    const r = await calculateRun(who(a), runId);
    expect(r).toMatchObject({ status: "CALCULATION_VALIDATED", workers: 3, variance: 2 });
    const lines = (await admin.from("calculation_lines").select("worker_id, net").eq("calculation_id", r.calculationId)).data!;
    const net = Object.fromEntries(lines.map((l) => [l.worker_id, formatUsdc(BigInt(l.net))]));
    // S: 2000 - 8h x 50 unpaid = 1600, tax 160 -> 1440 · H: 40h x 30 = 1200, tax 120 -> 1080 · R: 1000, tax 100 -> 900
    expect(net).toEqual({ [ids.S]: "1440.00", [ids.H]: "1080.00", [ids.R]: "900.00" });
    await expect(applyTransition(runStore, runMachine, { id: runId, companyId: a.id, action: "submit_for_approval", actor: "t", actorType: "script", correlationId: randomUUID() })).rejects.toThrow(); // rule 17: SIMULATION never moves on
    expect(await status(runId)).toBe("CALCULATION_VALIDATED");
  });

  it("the same inputs reproduce the same hash (rule 9) and calculating twice is refused", async () => {
    const calc = (await admin.from("calculations").select("id, calculation_hash, snapshot_enc").eq("run_id", runId).single()).data!;
    const snap = await openJson<{ config: never; entries: { worker: { workerId: string; payType: never; baseAmount: string; hourlyRate: string }; input: object }[] }>(a.id, "calculations", "snapshot_enc", calc.id, calc.snapshot_enc);
    const entries = snap.entries.map((e) => ({ ...e, worker: { ...e.worker, baseAmount: BigInt(e.worker.baseAmount), hourlyRate: BigInt(e.worker.hourlyRate) } })) as unknown as EngineEntry[];
    expect(calculatePayroll(snap.config, entries).calculationHash).toBe(calc.calculation_hash);
    await expect(calculateRun(who(a), runId)).rejects.toBeInstanceOf(TransitionError);
  });

  it("S46/S48: the snapshot names the evidence it used, by ID and source hash, and that evidence cannot change", async () => {
    const calc = (await admin.from("calculations").select("id, snapshot_enc").eq("run_id", runId).single()).data!;
    const snap = await openJson<{ evidence: Record<string, { id: string; source_hash: string }[]>; decisions: Record<string, string> }>(a.id, "calculations", "snapshot_enc", calc.id, calc.snapshot_enc);
    expect(snap.evidence.timesheets).toHaveLength(15); // 4 + 6 (one duplicated line) + 5
    expect(snap.evidence.actualPayments).toHaveLength(2);
    expect(Object.values(snap.decisions).sort()).toEqual(["KEEP_FIRST", "TREAT_AS_UNPAID_LEAVE"]);
    const stored = (await admin.from("timesheets").select("id, source_hash").eq("run_id", runId)).data!;
    for (const ev of snap.evidence.timesheets) expect(stored.find((s) => s.id === ev.id)?.source_hash).toBe(ev.source_hash);
    expect((await admin.from("timesheets").update({ hours: 1 }).eq("id", snap.evidence.timesheets[0].id)).error).not.toBeNull();
    await expect(importRows(who(a), { runId, ...row("TIMESHEETS", days("W201", ["9", "0", "0", "0", "0"])) })).rejects.toBeInstanceOf(WorkflowError);
  });

  it("the variance report: underpaid and never-paid workers, amounts encrypted at rest (S41)", async () => {
    const f = (await admin.from("variance_findings").select("id, worker_id, kind, detail_enc").eq("run_id", runId)).data!;
    expect(Object.fromEntries(f.map((x) => [x.worker_id, x.kind]))).toEqual({ [ids.H]: "UNDERPAID", [ids.R]: "NOT_PAID" });
    for (const x of f) expect(x.detail_enc).not.toMatch(/1080|900|1000/);
    const h = f.find((x) => x.worker_id === ids.H)!;
    expect(await openJson(a.id, "variance_findings", "detail_enc", h.id, h.detail_enc)).toEqual({ expected: "1080000000", actual: "1000000000", difference: "-80000000" });
    expect((await admin.from("variance_findings").update({ kind: "OVERPAID" }).eq("id", h.id)).error).not.toBeNull();
  });

  it("S13: another company cannot calculate this run", async () => {
    await expect(calculateRun(who(b), runId)).rejects.toBeInstanceOf(TransitionError);
  });

  it("a payment-side user cannot calculate", async () => {
    await expect(calculateRun({ ...who(a), roles: ["PAYMENT_APPROVER"] }, runId)).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("fails closed", () => {
  it("the engine refuses input it cannot price (extra hours with no agreed rate); the run stays READY, nothing is stored", async () => {
    const c = await makeCompany();
    const version = await company(c);
    await worker(c, "W301", "RETAINER", "1000", "0");
    const run = await newRun(c, version);
    await importRows(who(c), { runId: run, ...row("TIMESHEETS", days("W301", ["8", "8", "8", "8", "8"]).map((r, i) => ({ ...r, approvedExtraHours: i === 0 ? "2" : "0" }))) });
    await reconcileRun(who(c), run, noAdvice);
    expect(await status(run)).toBe("READY_FOR_CALCULATION");
    await expect(calculateRun(who(c), run)).rejects.toMatchObject({ code: "CALCULATION_BLOCKED", message: expect.stringContaining("W301") });
    expect(await status(run)).toBe("READY_FOR_CALCULATION");
    expect((await admin.from("calculations").select("id").eq("run_id", run)).data).toEqual([]);
  });
});
