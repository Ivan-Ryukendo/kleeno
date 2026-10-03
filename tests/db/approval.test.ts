// P4 slice 1: payroll approval (S16 re-auth), obligations (rules 15, 16, 49), recipient confirmation (ARCHITECTURE 12), signals wiring.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as approveRoute } from "@/app/api/runs/[id]/approve/route";
import { POST as confirmRoute } from "@/app/api/workers/[id]/recipient/confirm/route";
import { TransitionError } from "@/core/domain/machines";
import { WorkflowError } from "@/core/workflow";
import { approveRun, createObligations, rejectRun, submitRun } from "@/server/db/approval";
import { loadSignals } from "@/server/db/signals";
import { changeRecipient, confirmRecipient } from "@/server/db/workers";
import { ADDR, admin, approvedRun, call, cookieFor, makeCompany, pendingRun, withId, type TestCompany } from "./helpers";

const payroll = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles });
const as = (c: TestCompany, u: TestCompany["payroll"]) => ({ companyId: c.id, userId: u.id, correlationId: randomUUID() });
const obligations = async (runId: string) => (await admin.from("obligations").select("id, amount, recipient, status").eq("run_id", runId)).data!;
const runStatus = async (runId: string) => (await admin.from("payroll_runs").select("status").eq("id", runId).single()).data!.status;

describe("payroll approval creates the obligations", () => {
  it("binds the calculation hash, creates one obligation per payable line and is safe to repeat", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    expect(await approveRun(payroll(c), run.runId)).toEqual({ status: "OBLIGATIONS_CREATED", obligations: 1 });
    expect(await runStatus(run.runId)).toBe("OBLIGATIONS_CREATED");
    const [o] = await obligations(run.runId);
    expect(BigInt(o.amount)).toBe(run.calc.lines[0].net);
    expect(o.recipient).toBe(run.recipient);
    expect(o.status).toBe("CREATED");
    const approval = (await admin.from("payroll_approvals").select("calculation_hash, approver_id").eq("run_id", run.runId).single()).data!;
    expect(approval).toEqual({ calculation_hash: run.calc.calculationHash, approver_id: c.payroll.id });
    expect(await approveRun(payroll(c), run.runId)).toEqual({ status: "OBLIGATIONS_CREATED", obligations: 1 });
    expect(await createObligations(payroll(c), run.runId)).toEqual({ status: "OBLIGATIONS_CREATED", obligations: 1 });
    expect(await obligations(run.runId)).toHaveLength(1);
  });

  it("only the user who started an approval can finish it (the immutable row names the approver four-eyes checks)", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    await admin.from("memberships").update({ roles: ["PAYMENT_APPROVER", "PAYROLL_APPROVER"] }).eq("company_id", c.id).eq("user_id", c.payment.id); // the DB only lets a payroll approver start an approval
    const started = await admin.from("payroll_approvals").insert({ company_id: c.id, run_id: run.runId, calculation_id: run.saved.calculationId, calculation_hash: run.calc.calculationHash, approver_id: c.payment.id });
    expect(started.error).toBeNull();
    await expect(approveRun(payroll(c), run.runId)).rejects.toMatchObject({ code: "FOUR_EYES" });
    expect(await runStatus(run.runId)).toBe("PENDING_APPROVAL");
  });

  it("only the payroll side can approve; a SIMULATION run can never be approved", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    await expect(approveRun({ ...payroll(c), roles: ["PAYMENT_APPROVER"] }, run.runId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sim = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-11-01", period_end: "2026-11-30", config_version: run.config.version }).select("id").single()).data!;
    await expect(approveRun(payroll(c), sim.id)).rejects.toMatchObject({ code: "SIMULATION_CANNOT_PAY" });
    await expect(createObligations(payroll(c), sim.id)).rejects.toMatchObject({ code: "SIMULATION_CANNOT_PAY" });
    expect(await obligations(sim.id)).toHaveLength(0);
  });

  it("submit and reject follow the state machine; a rejected run is terminal", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    await expect(submitRun(payroll(c), run.runId)).rejects.toThrow(TransitionError); // already pending
    expect(await rejectRun(payroll(c), run.runId)).toBe("REJECTED");
    await expect(approveRun(payroll(c), run.runId)).rejects.toThrow(TransitionError); // terminal: nothing can be approved or created
    expect(await obligations(run.runId)).toHaveLength(0);
  });
});

describe("recipient confirmation (four-eyes on the address)", () => {
  it("an unconfirmed external address blocks obligations until a different payment approver confirms it", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    await changeRecipient(as(c, c.payroll), run.workerId, ADDR(0xbeef));
    await expect(approveRun(payroll(c), run.runId)).rejects.toMatchObject({ code: "RECIPIENT_NOT_CONFIRMED" });
    expect(await runStatus(run.runId)).toBe("APPROVED"); // the approval stands; obligations wait
    expect(await obligations(run.runId)).toHaveLength(0);
    await confirmRecipient(as(c, c.payment), run.workerId);
    expect(await createObligations(payroll(c), run.runId)).toEqual({ status: "OBLIGATIONS_CREATED", obligations: 1 });
    expect((await obligations(run.runId))[0].recipient).toBe(ADDR(0xbeef));
  });

  it("the person who set the address cannot confirm it, in the repository or in the database", async () => {
    const c = await makeCompany({ live: true });
    const { workerId } = await pendingRun(c);
    await admin.from("memberships").update({ roles: ["PAYROLL_APPROVER", "PAYMENT_APPROVER"] }).eq("user_id", c.payroll.id).eq("company_id", c.id);
    await changeRecipient(as(c, c.payroll), workerId, ADDR(0xcafe));
    await expect(confirmRecipient(as(c, c.payroll), workerId)).rejects.toBeInstanceOf(WorkflowError);
    const forced = await admin.from("workers").update({ wallet_confirmed_address: ADDR(0xcafe), wallet_confirmed_by: c.payroll.id }).eq("id", workerId);
    expect(forced.error).not.toBeNull();
  });

  it("the database refuses a confirmer without the payment role, a stale address, and an obligation to an unconfirmed wallet", async () => {
    const c = await makeCompany({ live: true });
    const run = await approvedRun(c);
    await changeRecipient(as(c, c.payroll), run.workerId, ADDR(0xd00d));
    expect((await admin.from("workers").update({ wallet_confirmed_address: ADDR(0xd00d), wallet_confirmed_by: c.payroll.id }).eq("id", run.workerId)).error).not.toBeNull(); // payroll user has no payment role
    expect((await admin.from("workers").update({ wallet_confirmed_address: ADDR(0x1234), wallet_confirmed_by: c.payment.id }).eq("id", run.workerId)).error).not.toBeNull(); // not the current address

    const run2 = await pendingRun(c, undefined, 2);
    await changeRecipient(as(c, c.payroll), run2.workerId, ADDR(0xfeed));
    const ap = await admin.from("payroll_approvals").insert({ company_id: c.id, run_id: run2.runId, calculation_id: run2.saved.calculationId, calculation_hash: run2.calc.calculationHash, approver_id: c.payroll.id }).select("id").single();
    await admin.from("payroll_runs").update({ status: "APPROVED" }).eq("id", run2.runId);
    const id = randomUUID();
    const ob = await admin.from("obligations").insert({ id, company_id: c.id, run_id: run2.runId, worker_id: run2.workerId, calculation_line_id: run2.saved.lineIds.get(run2.workerId)!, approval_id: ap.data!.id, amount: 1, currency: "USDC", network: "ARC-TESTNET", recipient: ADDR(0xfeed), config_version: run2.config.version, calculation_hash: run2.calc.calculationHash, idempotency_key: randomUUID(), onchain_key: `0x${"1".repeat(64)}` });
    expect(ob.error).not.toBeNull();
  });
});

describe("S16 re-authentication on the routes", () => {
  it("approval and recipient confirmation need the password in the same request", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    const { cookie } = await cookieFor(c.payroll);
    const path = `/api/runs/${run.runId}/approve`;
    expect((await call(approveRoute, { cookie, path, body: {} }, withId(run.runId))).status).toBe(400); // password missing: strict body
    expect((await call(approveRoute, { cookie, path, body: { password: "not-the-password" } }, withId(run.runId))).status).toBe(401);
    expect(await runStatus(run.runId)).toBe("PENDING_APPROVAL");
    expect((await admin.from("payroll_approvals").select("id").eq("run_id", run.runId)).data).toHaveLength(0);
    expect((await admin.from("audit_events").select("id").eq("company_id", c.id).eq("event", "REAUTH_FAILED")).data!.length).toBeGreaterThan(0);
    expect((await call(approveRoute, { cookie, path, body: { password: c.payroll.password } }, withId(run.runId))).status).toBe(200);
    expect(await runStatus(run.runId)).toBe("OBLIGATIONS_CREATED");

    const run2 = await pendingRun(c, undefined, 2);
    await changeRecipient(as(c, c.payroll), run2.workerId, ADDR(0xabcd));
    const pay = (await cookieFor(c.payment)).cookie;
    const confirmPath = `/api/workers/${run2.workerId}/recipient/confirm`;
    expect((await call(confirmRoute, { cookie: pay, path: confirmPath, body: { password: "nope" } }, withId(run2.workerId))).status).toBe(401);
    expect((await call(confirmRoute, { cookie, path: confirmPath, body: { password: c.payroll.password } }, withId(run2.workerId))).status).toBe(403); // payroll role cannot confirm
    expect((await call(confirmRoute, { cookie: pay, path: confirmPath, body: { password: c.payment.password } }, withId(run2.workerId))).status).toBe(200);
  });
});

describe("signals wiring", () => {
  it("a worker with no settled history fires FIRST_PAYMENT for the run", async () => {
    const c = await makeCompany({ live: true });
    const run = await pendingRun(c);
    await approveRun(payroll(c), run.runId);
    const ob = (await obligations(run.runId))[0];
    expect(await loadSignals(c.id, run.runId)).toEqual([{ id: `FIRST_PAYMENT:${ob.id}`, code: "FIRST_PAYMENT", obligationId: ob.id }]);
  });
});
