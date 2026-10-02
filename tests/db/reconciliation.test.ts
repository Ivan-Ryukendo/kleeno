// P3 slice 3: reconciliation end to end on the real database. Rule 14 (open exceptions block), AI advice never resolves,
// S60 bulk resolve (all or nothing), S19 resolved exceptions are immutable, S13 isolation, encrypted notes (S41).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AiProvider } from "@/core/ai";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { parseUsdc } from "@/core/money";
import { WorkflowError } from "@/core/workflow";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { importRows } from "@/server/db/imports";
import { bulkResolve, matchSummary, reconcileRun, resolveException } from "@/server/db/reconciliation";
import { runStore } from "@/server/db/runs";
import { createWorker } from "@/server/db/workers";
import { scripted } from "../fixtures/ai/policy";
import { admin, makeCompany, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles, correlationId: randomUUID() });
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const NOTE = "CANARY-NOTE-checked with the manager";

/** Suggests the first allowed option for every item, like a cautious model would. */
const firstOption: AiProvider = {
  name: "fake",
  async complete(req) {
    const items = JSON.parse(req.input.json).items as { ref: string; options: string[] }[];
    return { model: "fake", text: JSON.stringify({ suggestions: items.map((i) => ({ ref: i.ref, action: i.options[0], confidence: "LOW" })) }) };
  },
};

async function setup(c: TestCompany) {
  const params = { scheduledHoursPerPeriod: "40", weeklyOvertimeThresholdHours: "40", overtimeMultiplier: "1.5", hourlyCapHours: "40", aboveCapMultiplier: "1.5", deductions: [], varianceTolerance: "0.01", rules: [{ ruleId: "BASE_SALARY" as const, clauseIds: ["C1"] }] };
  const w = who(c);
  const draft = await createConfigDraft(w, { params, clauses: [{ id: "C1", text: "policy" }] });
  for (const act of ["validate", "request_review", "approve", "activate"]) await configAction(w, draft.id, act);
  return draft.version;
}
async function newRun(c: TestCompany, version: number) {
  return (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-05", period_end: "2026-10-11", config_version: version, created_by: c.payroll.id }).select("id").single()).data!.id as string;
}
async function worker(c: TestCompany, code: string, payType: "SALARIED" | "HOURLY") {
  return createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: code, payType, compensation: { baseAmount: parseUsdc("1000"), hourlyRate: parseUsdc("20") } });
}
const sheets = (code: string, hours: string[], extra: { date: string; hours: string }[] = []) => [...DAYS.map((d, i) => ({ workerRef: code, date: d, hours: hours[i] })).filter((r) => r.hours !== "0"), ...extra.map((e) => ({ workerRef: code, ...e }))];
const load = (c: TestCompany, runId: string, rows: object[]) => importRows(who(c), { runId, type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items: rows.map((data, i) => ({ row: i + 2, data })) });
const exceptionsOf = async (runId: string) => (await admin.from("exceptions").select("*").eq("run_id", runId).order("created_at")).data!;
const statusOf = async (runId: string) => (await admin.from("payroll_runs").select("status").eq("id", runId).single()).data!.status as string;

let version: number;
let runId: string;

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  version = await setup(a);
  for (const [code, t] of [["W101", "SALARIED"], ["W102", "HOURLY"]] as const) await worker(a, code, t);
  runId = await newRun(a, version);
  await load(a, runId, [...sheets("W101", ["8", "8", "8", "8", "0"]), ...sheets("W102", ["8", "8", "8", "8", "8"], [{ date: DAYS[0], hours: "8" }])]); // W101 misses Friday; W102 has Monday twice
});

describe("the reconcile flow", () => {
  it("raises the duplicate first; AI advice is stored but resolves nothing; the run waits (rule 14)", async () => {
    const r = await reconcileRun(who(a), runId, firstOption);
    expect(r).toMatchObject({ status: "EXCEPTIONS_PENDING", open: 1 });
    const [ex] = await exceptionsOf(runId);
    expect(ex).toMatchObject({ category: "DUPLICATE_TIMESHEET", status: "OPEN", severity: "HIGH", resolution_action: null });
    expect(ex.ai_suggestion).toEqual({ action: "KEEP_FIRST", confidence: "LOW" });
    expect(ex.ai_execution_id).not.toBeNull();
    expect(ex.evidence.recordIds).toHaveLength(2);
    expect(JSON.stringify(ex.evidence)).not.toMatch(/W10|amount|1000/);
    expect(await statusOf(runId)).toBe("EXCEPTIONS_PENDING");
  });

  it("rule 14 holds in the database too: the run cannot reach READY_FOR_CALCULATION with an open exception", async () => {
    await expect(applyTransition(runStore, runMachine, { id: runId, companyId: a.id, action: "resolve_exceptions", actor: "test", actorType: "script", correlationId: randomUUID() })).rejects.toThrow();
    expect(await statusOf(runId)).toBe("EXCEPTIONS_PENDING");
  });

  it("running the checks twice is refused; nothing is duplicated", async () => {
    await expect(reconcileRun(who(a), runId, firstOption)).rejects.toBeInstanceOf(TransitionError);
    expect(await exceptionsOf(runId)).toHaveLength(1);
  });

  it("a decision needs an offered action and a note", async () => {
    const [ex] = await exceptionsOf(runId);
    await expect(resolveException(who(a), ex.id, { action: "APPROVE_HOURS", note: NOTE }, firstOption)).rejects.toBeInstanceOf(WorkflowError);
    await expect(resolveException(who(a), ex.id, { action: "KEEP_FIRST", note: " " }, firstOption)).rejects.toBeInstanceOf(WorkflowError);
    await expect(resolveException({ ...who(a), roles: ["PAYMENT_APPROVER"] }, ex.id, { action: "KEEP_FIRST", note: NOTE }, firstOption)).rejects.toBeInstanceOf(WorkflowError);
    await expect(resolveException(who(b), ex.id, { action: "KEEP_FIRST", note: NOTE }, firstOption)).rejects.toBeInstanceOf(TransitionError); // S13
    expect((await exceptionsOf(runId))[0].status).toBe("OPEN");
  });

  it("resolving the duplicate reveals the missing hours (stage 2); resolving that frees the run", async () => {
    const [dup] = await exceptionsOf(runId);
    const r1 = await resolveException(who(a), dup.id, { action: "KEEP_FIRST", note: NOTE }, firstOption);
    expect(r1).toMatchObject({ status: "EXCEPTIONS_PENDING", open: 1 });
    const rows = await exceptionsOf(runId);
    expect(rows.map((e) => [e.category, e.status])).toEqual([["DUPLICATE_TIMESHEET", "RESOLVED"], ["UNEXPLAINED_MISSING_HOURS", "OPEN"]]);
    expect(rows[1].evidence.facts).toMatchObject({ missingHours: "8" });

    const r2 = await resolveException(who(a), rows[1].id, { action: "TREAT_AS_UNPAID_LEAVE", note: NOTE }, firstOption);
    expect(r2).toMatchObject({ status: "READY_FOR_CALCULATION", open: 0 });
    expect(await statusOf(runId)).toBe("READY_FOR_CALCULATION");
  });

  it("each resolution is audited; the note is encrypted at rest; resolved rows are immutable", async () => {
    const rows = await exceptionsOf(runId);
    for (const e of rows) {
      expect(e.resolution).not.toContain("CANARY-NOTE");
      expect(e.resolved_by).toBe(a.payroll.id);
      const ev = (await admin.from("audit_events").select("event").eq("entity_id", e.id)).data!.map((x) => x.event);
      expect(ev).toEqual(expect.arrayContaining(["exception.start_review", "exception.resolve"]));
      expect((await admin.from("exceptions").update({ resolution_action: "KEEP_ALL" }).eq("id", e.id)).error).not.toBeNull();
      expect((await admin.from("exceptions").delete().eq("id", e.id)).error).not.toBeNull();
    }
  });

  it("match summary counts from stored evidence (ARCHITECTURE 9)", async () => {
    expect(await matchSummary(admin, a.id, runId)).toEqual({ total: 10, autoMatched: 0 + 4, afterReview: 6, needReview: 0 });
  });
});

describe("S60 bulk resolve", () => {
  let run2: string;
  beforeAll(async () => {
    for (const code of ["W111", "W112", "W113"]) await worker(a, code, "HOURLY");
    run2 = await newRun(a, version);
    await load(a, run2, ["W111", "W112", "W113"].flatMap((c) => sheets(c, ["8", "8", "8", "8", "8"], [{ date: DAYS[1], hours: "8" }])));
    await reconcileRun(who(a), run2, firstOption);
  });

  it("is all or nothing: one foreign id fails the whole request and changes nothing", async () => {
    const ids = (await exceptionsOf(run2)).map((e) => e.id);
    expect(ids).toHaveLength(3);
    const other = (await exceptionsOf(runId))[0].id; // resolved, other run
    await expect(bulkResolve(who(a), { runId: run2, category: "DUPLICATE_TIMESHEET", ids: [...ids.slice(0, 2), other], action: "KEEP_FIRST", note: NOTE }, firstOption)).rejects.toBeInstanceOf(TransitionError);
    await expect(bulkResolve(who(a), { runId: run2, category: "DUPLICATE_TIMESHEET", ids, action: "EXCLUDE_HOURS", note: NOTE }, firstOption)).rejects.toBeInstanceOf(WorkflowError);
    await expect(bulkResolve(who(a), { runId: run2, category: "LEAVE_WORK_CONFLICT", ids, action: "KEEP_WORK", note: NOTE }, firstOption)).rejects.toBeInstanceOf(TransitionError);
    expect((await exceptionsOf(run2)).every((e) => e.status === "OPEN")).toBe(true);
  });

  it("resolves a category with one note; every exception still gets its own resolution and audit events", async () => {
    const ids = (await exceptionsOf(run2)).map((e) => e.id);
    const r = await bulkResolve(who(a), { runId: run2, category: "DUPLICATE_TIMESHEET", ids, action: "KEEP_FIRST", note: NOTE }, firstOption);
    // W101 is an active salaried worker with no hours in this run: once the duplicates are settled, their missing time surfaces.
    expect(r).toMatchObject({ resolved: 3, status: "EXCEPTIONS_PENDING", open: 1 });
    const missing = (await exceptionsOf(run2)).find((e) => e.category === "UNEXPLAINED_MISSING_HOURS")!;
    expect(missing.evidence.facts).toMatchObject({ workedHours: "0", missingHours: "40" });
    expect(await resolveException(who(a), missing.id, { action: "TREAT_AS_PAID_LEAVE", note: NOTE }, firstOption)).toMatchObject({ status: "READY_FOR_CALCULATION" });
    for (const id of ids) expect((await admin.from("audit_events").select("event").eq("entity_id", id).eq("event", "exception.resolve")).data).toHaveLength(1);
    expect((await admin.from("audit_events").select("refs").eq("entity_id", run2).eq("event", "exception.bulk_resolve").single()).data!.refs).toMatchObject({ count: 3 });
  });

  it("more than 200 ids is refused", async () => {
    await expect(bulkResolve(who(a), { runId: run2, category: "DUPLICATE_TIMESHEET", ids: Array.from({ length: 201 }, () => randomUUID()), action: "KEEP_FIRST", note: NOTE }, firstOption)).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("when the AI cannot help", () => {
  it("an outage or an invalid suggestion leaves the exception without advice, never without the exception", async () => {
    for (const ai of [scripted([new Error("down")]), scripted([{ suggestions: [{ ref: "e1", action: "APPROVE_HOURS", confidence: "HIGH" }] }])]) {
      const run = await newRun(a, version);
      await load(a, run, sheets("W102", ["8", "8", "8", "8", "8"], [{ date: DAYS[3], hours: "8" }]));
      await reconcileRun(who(a), run, ai);
      const [ex] = await exceptionsOf(run);
      expect(ex).toMatchObject({ category: "DUPLICATE_TIMESHEET", status: "OPEN", ai_suggestion: null });
      expect((await admin.from("ai_executions").select("status").eq("id", ex.ai_execution_id).single()).data!.status).toBe("NEEDS_HUMAN_REVIEW");
    }
  });
});
