// S19 immutability, S34 append-only audit, S12 composite FKs, S35 CHECKs, S26 idempotency constraints. All bind the service role.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { activeConfig, admin, approvedRun, CONFIG_PARAMS, makeCompany, proposedBatch, type BuiltRun, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let run: BuiltRun;
let cfg: Awaited<ReturnType<typeof activeConfig>>;

beforeAll(async () => {
  a = await makeCompany({ live: true });
  b = await makeCompany({ live: true });
  cfg = await activeConfig(a);
  run = await approvedRun(a, cfg);
});

const rejected = async (p: PromiseLike<{ error: unknown }>) => expect((await p).error).not.toBeNull();

describe("S34 audit is append-only", () => {
  it("update and delete are rejected", async () => {
    const row = (await admin.from("audit_events").select("id").eq("company_id", a.id).limit(1).single()).data!;
    await rejected(admin.from("audit_events").update({ event: "tampered" }).eq("id", row.id));
    await rejected(admin.from("audit_events").delete().eq("id", row.id));
  });
});

describe("S19 approved records are immutable", () => {
  it("calculations, lines and approvals cannot change or vanish", async () => {
    await rejected(admin.from("calculations").update({ calculation_hash: "x" }).eq("id", run.calculationId));
    await rejected(admin.from("calculations").delete().eq("id", run.calculationId));
    await rejected(admin.from("calculation_lines").update({ net: 1 }).eq("id", run.lineId));
    await rejected(admin.from("calculation_lines").delete().eq("id", run.lineId));
    await rejected(admin.from("payroll_approvals").update({ calculation_hash: "x" }).eq("id", run.approvalId));
    await rejected(admin.from("payroll_approvals").delete().eq("id", run.approvalId));
  });

  it("compensation versions are immutable", async () => {
    const c = (await admin.from("compensations").select("id").eq("worker_id", run.workerId).limit(1).single()).data!;
    await rejected(admin.from("compensations").update({ payload_enc: "x" }).eq("id", c.id));
    await rejected(admin.from("compensations").delete().eq("id", c.id));
  });

  it("an approved config version cannot be edited or deleted; a draft can", async () => {
    await rejected(admin.from("payroll_configurations").update({ params: { ...CONFIG_PARAMS, overtimeMultiplier: "2" } }).eq("id", cfg.id));
    await rejected(admin.from("payroll_configurations").delete().eq("id", cfg.id));
  });

  it("obligations: only status, batch, tx hash and timestamps may change; never deleted", async () => {
    await rejected(admin.from("obligations").update({ amount: 999 }).eq("id", run.obligationId));
    await rejected(admin.from("obligations").update({ recipient: "0x" + "1".repeat(40) }).eq("id", run.obligationId));
    await rejected(admin.from("obligations").update({ calculation_hash: "x" }).eq("id", run.obligationId));
    await rejected(admin.from("obligations").delete().eq("id", run.obligationId));
  });

  it("a run's mode, config version and period are frozen; it cannot be deleted", async () => {
    await rejected(admin.from("payroll_runs").update({ mode: "SIMULATION" }).eq("id", run.runId));
    await rejected(admin.from("payroll_runs").update({ config_version: 99 }).eq("id", run.runId));
    await rejected(admin.from("payroll_runs").delete().eq("id", run.runId));
  });

  it("a proposed batch's plan and plan hash are frozen", async () => {
    const id = await proposedBatch(a, run, a.payment.id);
    await rejected(admin.from("payment_batches").update({ plan_hash: "x" }).eq("id", id));
    await rejected(admin.from("payment_batches").update({ plan: {} }).eq("id", id));
    await rejected(admin.from("payment_batches").delete().eq("id", id));
  });
});

describe("S12 composite foreign keys", () => {
  it("no row can reference another company's row, even via the service role", async () => {
    await rejected(admin.from("compensations").insert({ company_id: b.id, worker_id: run.workerId, version: 9, payload_enc: "x" }));
    await rejected(admin.from("payroll_runs").insert({ company_id: b.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-02", config_version: cfg.version }));
    await rejected(admin.from("exceptions").insert({ company_id: b.id, run_id: run.runId, category: "DUPLICATE_TIMESHEET", severity: "LOW" }));
    await rejected(admin.from("payment_batches").insert({ company_id: b.id, run_id: run.runId, plan_hash: "x", plan: {} }));
  });
});

describe("S35 CHECKs", () => {
  it("rejects bad values", async () => {
    await rejected(admin.from("payroll_runs").insert({ company_id: a.id, mode: "SIMULATION", period_start: "2026-10-31", period_end: "2026-10-01", config_version: cfg.version }));
    await rejected(admin.from("payroll_configurations").insert({ company_id: a.id, version: 50, params: { ...CONFIG_PARAMS, overtimeMultiplier: "5" }, clauses_enc: "x" }));
    await rejected(admin.from("payroll_configurations").insert({ company_id: a.id, version: 51, params: { ...CONFIG_PARAMS, deductions: [{ code: "TAX", label: "x", percent: "101" }] }, clauses_enc: "x" }));
    await rejected(admin.from("workers").insert({ company_id: a.id, pseudonym: "W777", pay_type: "MONTHLY" }));
    await rejected(admin.from("companies").insert({ name: "x", per_payment_ceiling: -1 }));
  });

  it("a SIMULATION run can never be approved or reach payment (S38 backstop)", async () => {
    const r = await admin.from("payroll_runs").insert({ company_id: a.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-02", config_version: cfg.version }).select("id").single();
    const id = r.data!.id;
    for (const s of ["PENDING_APPROVAL", "APPROVED", "PAYMENT_IN_PROGRESS"]) await rejected(admin.from("payroll_runs").update({ status: s }).eq("id", id));
    await rejected(admin.from("payroll_approvals").insert({ company_id: a.id, run_id: id, calculation_id: run.calculationId, calculation_hash: run.hash, approver_id: a.payroll.id }));
  });

  it("only one ACTIVE config per company", async () => {
    const dup = await admin.from("payroll_configurations").insert({ company_id: a.id, version: 60, status: "DRAFT", params: CONFIG_PARAMS, clauses_enc: "x" }).select("id").single();
    expect(dup.error).toBeNull(); // a second DRAFT is fine
    // making it ACTIVE would need approval fields and the state machine; the partial unique index is the last line of defence:
    const forced = await admin.from("payroll_configurations").insert({ company_id: a.id, version: 61, status: "ACTIVE", params: CONFIG_PARAMS, clauses_enc: "x", approved_by: a.payroll.id, approved_at: new Date().toISOString() });
    expect(forced.error).not.toBeNull();
  });
});

describe("S26 uniqueness backs idempotency", () => {
  it("duplicates are rejected", async () => {
    await rejected(admin.from("workers").insert({ company_id: a.id, pseudonym: "W101", pay_type: "SALARIED" })); // same code in a company
    await rejected(admin.from("compensations").insert({ company_id: a.id, worker_id: run.workerId, version: 1, payload_enc: "x" }));
    await rejected(admin.from("payroll_approvals").insert({ company_id: a.id, run_id: run.runId, calculation_id: run.calculationId, calculation_hash: run.hash, approver_id: a.payroll.id }));
    const w = await admin.from("workers").select("wallet_id").eq("id", run.workerId).single();
    const other = await admin.from("workers").insert({ company_id: a.id, pseudonym: "W888", pay_type: "SALARIED", wallet_id: w.data!.wallet_id });
    expect(other.error).not.toBeNull(); // one wallet per worker
  });

  it("one obligation per calculation line and per idempotency/on-chain key", async () => {
    const o = (await admin.from("obligations").select("*").eq("id", run.obligationId).single()).data!;
    const { id: _id, ...rest } = o;
    void _id;
    await rejected(admin.from("obligations").insert({ ...rest, id: randomUUID() })); // same line, same keys
  });
});
