// S06 (kill-switch backstop), rule 18 (four-eyes trigger), rules 15/16 (approval + obligation integrity), S38 (SIMULATION).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { batchMachine, obligationMachine, type BatchState, type ObligationState } from "@/core/domain/machines";
import { dbStore } from "@/server/db/store";
import { activeConfig, admin, approvedRun, makeCompany, pendingRun, proposedBatch, step } from "./helpers";

const batches = dbStore<BatchState>("payment_batches");
const obligations = dbStore<ObligationState>("obligations");
const setLive = (id: string, on: boolean) => admin.from("companies").update({ live_payments_enabled: on }).eq("id", id);

describe("S06 kill switch in the database", () => {
  it("with live payments OFF nothing that starts a payment can be written", async () => {
    const c = await makeCompany({ live: true });
    const cfg = await activeConfig(c);
    const run = await approvedRun(c, cfg);
    const batchId = await proposedBatch(c, run, c.payment.id);
    await setLive(c.id, false);

    const live = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "LIVE_TESTNET", period_start: "2026-11-01", period_end: "2026-11-30", config_version: cfg.version });
    expect(live.error).not.toBeNull(); // LIVE run creation
    await expect(step(batches, batchMachine, c, batchId, ["authorize"])).rejects.toThrow(); // plan signing
    const attempt = await admin.from("payment_attempts").insert({ company_id: c.id, obligation_id: run.obligationId, idempotency_key: randomUUID(), state: "SUBMISSION_PENDING" });
    expect(attempt.error).not.toBeNull(); // any submission

    const sim = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-11-01", period_end: "2026-11-30", config_version: cfg.version });
    expect(sim.error).toBeNull(); // SIMULATION is unaffected
  });

  it("an obligation cannot be claimed (AUTHORIZED -> PAYING) after the switch goes OFF", async () => {
    const c = await makeCompany({ live: true });
    const run = await approvedRun(c);
    const batchId = await proposedBatch(c, run, c.payment.id);
    await step(batches, batchMachine, c, batchId, ["authorize"]);
    await admin.from("obligations").update({ batch_id: batchId }).eq("id", run.obligationId);
    await step(obligations, obligationMachine, c, run.obligationId, ["authorize"]);
    await setLive(c.id, false);
    await expect(step(obligations, obligationMachine, c, run.obligationId, ["claim"])).rejects.toThrow();
    expect((await admin.from("obligations").select("status").eq("id", run.obligationId).single()).data!.status).toBe("AUTHORIZED");
    await setLive(c.id, true);
    await step(obligations, obligationMachine, c, run.obligationId, ["claim"]);
    expect((await admin.from("obligations").select("status").eq("id", run.obligationId).single()).data!.status).toBe("PAYING");
  });
});

describe("rule 18 four-eyes and role trigger", () => {
  it("the payroll approver cannot authorize their own run's payment; a payment approver can", async () => {
    const c = await makeCompany({ live: true });
    const run = await approvedRun(c);
    const self = await proposedBatch(c, run, c.payroll.id);
    await expect(step(batches, batchMachine, c, self, ["authorize"])).rejects.toThrow();
    const ok = await proposedBatch(c, run, c.payment.id);
    await step(batches, batchMachine, c, ok, ["authorize"]);
    expect((await admin.from("payment_batches").select("status").eq("id", ok).single()).data!.status).toBe("AUTHORIZED");
  });

  it("a batch cannot be born authorized, and a null or wrong-role authorizer is refused", async () => {
    const c = await makeCompany({ live: true });
    const run = await approvedRun(c);
    const born = await admin.from("payment_batches").insert({ company_id: c.id, run_id: run.runId, status: "AUTHORIZED", authorizer_id: c.payment.id, plan_hash: "x", plan: {} });
    expect(born.error).not.toBeNull();
    const none = await proposedBatch(c, run, null);
    await expect(step(batches, batchMachine, c, none, ["authorize"])).rejects.toThrow();
    const otherPayroll = await admin.from("memberships").insert({ user_id: (await admin.auth.admin.createUser({ email: `dbtest-${randomUUID()}@example.com`, password: `pw-${randomUUID()}`, email_confirm: true })).data.user!.id, company_id: c.id, roles: ["HR_APPROVER"] }).select("user_id").single();
    const wrongRole = await proposedBatch(c, run, otherPayroll.data!.user_id);
    await expect(step(batches, batchMachine, c, wrongRole, ["authorize"])).rejects.toThrow();
  });
});

describe("rules 15-16 approval and obligation integrity", () => {
  it("approval needs a payroll role, the calculation's exact hash and a run pending approval", async () => {
    const c = await makeCompany({ live: true });
    const p = await pendingRun(c);
    const base = { company_id: c.id, run_id: p.runId, calculation_id: p.saved.calculationId };
    expect((await admin.from("payroll_approvals").insert({ ...base, calculation_hash: p.calc.calculationHash, approver_id: c.payment.id })).error).not.toBeNull(); // wrong role
    expect((await admin.from("payroll_approvals").insert({ ...base, calculation_hash: "0".repeat(64), approver_id: c.payroll.id })).error).not.toBeNull(); // wrong hash
    expect((await admin.from("payroll_approvals").insert({ ...base, calculation_hash: p.calc.calculationHash, approver_id: c.payroll.id })).error).toBeNull();
  });

  it("no obligation without an approved LIVE run and a matching approval", async () => {
    const c = await makeCompany({ live: true });
    const run = await approvedRun(c);
    const p = await pendingRun(c, undefined, 2); // second run, not approved
    const line = (await admin.from("calculation_lines").select("id").eq("calculation_id", p.saved.calculationId).single()).data!;
    const oid = randomUUID();
    const ob = await admin.from("obligations").insert({ id: oid, company_id: c.id, run_id: p.runId, worker_id: p.workerId, calculation_line_id: line.id, approval_id: run.approvalId, amount: 1, currency: "USDC", network: "ARC-TESTNET", recipient: p.recipient, config_version: 1, calculation_hash: p.calc.calculationHash, idempotency_key: randomUUID(), onchain_key: "0x" + "ab".repeat(32) });
    expect(ob.error).not.toBeNull();
  });
});
