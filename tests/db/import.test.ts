// P3 slice 2: import evidence. S46 provenance, S25 server-side typed rows, S26 idempotency, S48 snapshot isolation, S41 amounts, S13.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { parseUsdc } from "@/core/money";
import { WorkflowError } from "@/core/workflow";
import { importRows } from "@/server/db/imports";
import { runStore } from "@/server/db/runs";
import { createWorker } from "@/server/db/workers";
import { activeConfig, admin, makeCompany, step, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let runId: string;
const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, role: c.payroll.role, correlationId: randomUUID() });
const ts = (workerRef: string, date: string, hours: string, extra?: Record<string, string>) => ({ workerRef, date, hours, ...extra });
const items = (rows: object[], from = 2) => rows.map((data, i) => ({ row: from + i, data }));
const MAP = { workerRef: 0, date: 1, hours: 2 };
const imp = (type: "TIMESHEETS" | "LEAVE" | "ACTUAL_PAID", rows: object[], run = runId, c = a) => importRows(who(c), { runId: run, type, mapping: type === "ACTUAL_PAID" ? { workerRef: 0, amount: 1 } : MAP, items: items(rows) });

async function newRun(c: TestCompany) {
  const cfg = await activeConfig(c);
  const r = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-31", config_version: cfg.config.version, created_by: c.payroll.id }).select("id").single();
  return r.data!.id as string;
}

beforeAll(async () => {
  a = await makeCompany();
  b = await makeCompany();
  for (const code of ["W001", "W002"]) await createWorker({ companyId: a.id, userId: a.payroll.id, correlationId: randomUUID() }, { pseudonym: code, payType: "SALARIED", compensation: { baseAmount: parseUsdc("1000"), hourlyRate: 0n } });
  runId = await newRun(a);
});

describe("importing timesheets", () => {
  it("stores rows with full provenance, moves the run to DATA_IMPORTED and audits without values", async () => {
    const r = await imp("TIMESHEETS", [ts("W001", "2026-10-01", "8"), ts("W001", "2026-10-02", "9", { approvedExtraHours: "1" }), ts("W002", "2026-10-01", "8")]);
    expect(r).toMatchObject({ alreadyImported: false, rows: 3, accepted: 3, newRecords: 3, rejected: [] });
    const rows = (await admin.from("timesheets").select("*").eq("run_id", runId)).data!;
    expect(rows).toHaveLength(3);
    for (const x of rows) expect(x).toMatchObject({ source_provider: "csv_upload", object_type: "timesheet", import_batch_id: r.batchId, occurrence: 1 });
    expect(rows.every((x) => /^[0-9a-f]{64}$/.test(x.source_hash) && x.fetched_at && x.object_id.includes("|"))).toBe(true);
    expect((await admin.from("payroll_runs").select("status").eq("id", runId).single()).data!.status).toBe("DATA_IMPORTED");
    const audit = (await admin.from("audit_events").select("refs").eq("event", "import.create").eq("entity_id", r.batchId!).single()).data!;
    expect(audit.refs).toMatchObject({ type: "TIMESHEETS", rows: 3, newRecords: 3 });
    expect(JSON.stringify(audit.refs)).not.toMatch(/W00|2026-10/);
  });

  it("S26: the same data again is one batch and no new records", async () => {
    const before = (await admin.from("timesheets").select("id").eq("run_id", runId)).data!.length;
    const r = await imp("TIMESHEETS", [ts("W001", "2026-10-01", "8"), ts("W001", "2026-10-02", "9", { approvedExtraHours: "1" }), ts("W002", "2026-10-01", "8")]);
    expect(r).toMatchObject({ alreadyImported: true, newRecords: 0 });
    expect((await admin.from("timesheets").select("id").eq("run_id", runId)).data!).toHaveLength(before);
  });

  it("a duplicated line in the file is kept as occurrence 2, so reconciliation can flag it", async () => {
    const run2 = await newRun(a);
    await imp("TIMESHEETS", [ts("W001", "2026-10-05", "8"), ts("W001", "2026-10-05", "8")], run2);
    const rows = (await admin.from("timesheets").select("occurrence").eq("run_id", run2).order("occurrence")).data!;
    expect(rows.map((x) => x.occurrence)).toEqual([1, 2]);
  });

  it("S48: a changed record is a new evidence row; the old one is untouched and evidence is immutable", async () => {
    const run3 = await newRun(a);
    await imp("TIMESHEETS", [ts("W001", "2026-10-06", "8")], run3);
    await imp("TIMESHEETS", [ts("W001", "2026-10-06", "10")], run3);
    const rows = (await admin.from("timesheets").select("id, hours").eq("run_id", run3).order("hours")).data!;
    expect(rows.map((x) => Number(x.hours))).toEqual([8, 10]);
    expect((await admin.from("timesheets").update({ hours: 1 }).eq("id", rows[0].id)).error).not.toBeNull();
    expect((await admin.from("timesheets").delete().eq("id", rows[0].id)).error).not.toBeNull();
  });

  it("S20/S48: once reconciliation starts the run takes no more data", async () => {
    const run4 = await newRun(a);
    await imp("TIMESHEETS", [ts("W001", "2026-10-07", "8")], run4);
    await step(runStore, runMachine, a, run4, ["start_reconciliation"]);
    await expect(imp("TIMESHEETS", [ts("W001", "2026-10-08", "8")], run4)).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("rejected rows (S25 server side)", () => {
  it("unknown workers, out-of-period dates and bad values are rejected with codes, never cell text", async () => {
    const run5 = await newRun(a);
    const r = await imp("TIMESHEETS", [ts("W001", "2026-10-09", "8"), ts("W999", "2026-10-09", "8"), ts("W001", "2026-11-09", "8"), ts("W001", "2026-10-10", "30"), { workerRef: "Jane Doe", date: "2026-10-10", hours: "8" }], run5);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([
      { row: 3, field: "workerRef", code: "UNKNOWN_WORKER" },
      { row: 4, field: "date", code: "OUT_OF_PERIOD" },
      { row: 5, field: "hours", code: "BAD_VALUE" },
      { row: 6, field: "workerRef", code: "BAD_VALUE" },
    ]);
    const batch = (await admin.from("import_batches").select("rejected, mapping").eq("id", r.batchId!).single()).data!;
    expect(JSON.stringify(batch)).not.toMatch(/Jane|W999/);
  });

  it("a file with nothing acceptable creates no batch", async () => {
    const r = await imp("TIMESHEETS", [ts("W999", "2026-10-09", "8")], await newRun(a));
    expect(r).toMatchObject({ batchId: null, accepted: 0 });
  });

  it("an unknown mapping field is refused", async () => {
    await expect(importRows(who(a), { runId, type: "TIMESHEETS", mapping: { salary: 0 }, items: items([ts("W001", "2026-10-09", "8")]) })).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("actual payments (S41, rule 7)", () => {
  it("amounts are encrypted at rest; non-USD is rejected", async () => {
    const run6 = await newRun(a);
    const r = await imp("ACTUAL_PAID", [{ workerRef: "W001", amount: "1234.56" }, { workerRef: "W002", amount: "99.99", currency: "EUR" }], run6);
    expect(r).toMatchObject({ accepted: 1, rejected: [{ row: 3, field: "currency", code: "CURRENCY" }] });
    const row = (await admin.from("actual_payments").select("*").eq("run_id", run6).single()).data!;
    expect(row.amount_enc).not.toContain("1234");
    expect(JSON.stringify(row)).not.toContain("1234.56");
    expect(row).toMatchObject({ currency: "USD", object_type: "actual_payment", object_id: "W001" });
  });
});

describe("leave", () => {
  it("stores typed leave with provenance", async () => {
    const run7 = await newRun(a);
    const r = await importRows(who(a), { runId: run7, type: "LEAVE", mapping: { workerRef: 0, date: 1, leaveType: 2, hours: 3 }, items: items([{ workerRef: "W001", date: "2026-10-12", leaveType: "PAID", hours: "8" }]) });
    expect(r.newRecords).toBe(1);
    expect((await admin.from("leave_records").select("leave_type, object_type").eq("run_id", run7).single()).data).toEqual({ leave_type: "PAID", object_type: "leave" });
  });
});

describe("S46 provenance is mandatory; S13 isolation; roles", () => {
  it("evidence without provenance is rejected by the database", async () => {
    const base = { company_id: a.id, run_id: runId, worker_id: (await admin.from("workers").select("id").eq("company_id", a.id).limit(1).single()).data!.id, work_date: "2026-10-01", hours: 8 };
    expect((await admin.from("timesheets").insert(base)).error).not.toBeNull();
    expect((await admin.from("timesheets").insert({ ...base, import_batch_id: randomUUID(), source_provider: "csv_upload", object_type: "timesheet", object_id: "x", fetched_at: new Date().toISOString(), source_hash: "nothex" })).error).not.toBeNull();
  });

  it("another company cannot import into this run, and the payment side cannot import", async () => {
    await expect(imp("TIMESHEETS", [ts("W001", "2026-10-01", "8")], runId, b)).rejects.toBeInstanceOf(TransitionError);
    await expect(importRows({ ...who(a), role: "PAYMENT_APPROVER" }, { runId, type: "TIMESHEETS", mapping: MAP, items: items([ts("W001", "2026-10-01", "8")]) })).rejects.toBeInstanceOf(WorkflowError);
  });
});
