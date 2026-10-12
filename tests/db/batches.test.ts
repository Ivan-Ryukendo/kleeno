// P4 slice 2: plans, holds, signing, opening the guard run (rules 22-25, S05, S06, S08, S16). A fake owner port stands in for Circle and Arc.
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { POST as signRoute } from "@/app/api/batches/[id]/sign/route";
import { runMachine, TransitionError } from "@/core/domain/machines";
import { approveRun } from "@/server/db/approval";
import { discardBatch, openBatch, proposeBatch, signBatch } from "@/server/db/batches";
import { runStore } from "@/server/db/runs";
import { changeRecipient } from "@/server/db/workers";
import { ADDR, admin, call, cookieFor, makeCompany, pendingRun, step, withId, type TestCompany } from "./helpers";
import { FakePort } from "./payment-fakes";

const payroll = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles });
const payment = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });
/** A LIVE company with a run of two workers taken to OBLIGATIONS_CREATED. */
async function setup() {
  const c = await makeCompany({ live: true });
  const run = await pendingRun(c, undefined, 1, 1);
  await approveRun(payroll(c), run.runId);
  const obs = (await admin.from("obligations").select("id, status, batch_id, worker_id").eq("run_id", run.runId).order("id")).data!;
  return { c, run, obs };
}
const status = async (table: string, id: string) => (await admin.from(table).select("status").eq("id", id).single()).data!.status;

describe("proposing a plan", () => {
  it("covers every obligation once, stores the signals, and replaces an earlier proposal", async () => {
    const { c, run, obs } = await setup();
    const p1 = await proposeBatch(payment(c), run.runId, []);
    expect(p1.held).toBe(0);
    expect(p1.signals.map((s) => s.code)).toEqual(["FIRST_PAYMENT", "FIRST_PAYMENT"]);
    const stored = (await admin.from("payment_batches").select("plan, status").eq("id", p1.batchId).single()).data!;
    expect(stored.status).toBe("PROPOSED");
    expect(stored.plan.obligations.map((o: { id: string }) => o.id)).toEqual(obs.map((o) => o.id));
    expect(stored.plan.source).toBe("FALLBACK");

    const p2 = await proposeBatch(payment(c), run.runId, [obs[0].id]);
    expect(await status("payment_batches", p1.batchId)).toBe("DISCARDED");
    expect(await status("obligations", obs[0].id)).toBe("ON_HOLD"); // placing a hold needs no signature
    expect(p2.held).toBe(1);
  });

  it("only a payment approver plans; everything on hold is refused; a SIMULATION run is never planned", async () => {
    const { c, run, obs } = await setup();
    await expect(proposeBatch(payroll(c), run.runId, [])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(proposeBatch(payment(c), run.runId, obs.map((o) => o.id))).rejects.toMatchObject({ code: "PLAN_INVALID" });
    const sim = (await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", period_start: "2026-11-01", period_end: "2026-11-30", config_version: run.config.version }).select("id").single()).data!;
    await expect(proposeBatch(payment(c), sim.id, [])).rejects.toMatchObject({ code: "SIMULATION_CANNOT_PAY" });
  });

  it("falls back to a human-signed plan when planner setup lacks a wallet, while preserving manual-hold validation", async () => {
    const { c, run, obs } = await setup(); // test company has no approver wallet/guard provisioning
    await expect(proposeBatch(payment(c), run.runId, [randomUUID()], { planner: true })).rejects.toMatchObject({ code: "PLAN_INVALID" });

    const plan = await proposeBatch(payment(c), run.runId, [obs[0].id], { planner: true });
    expect(plan.source).toBe("FALLBACK");
    expect(plan.proposal).toBeNull();
    expect(plan.held).toBe(1);
    const stored = (await admin.from("payment_batches").select("plan").eq("id", plan.batchId).single()).data!;
    expect(stored.plan.source).toBe("FALLBACK");
    expect(stored.plan.heldIds).toEqual([obs[0].id]);
  });
});

describe("signing", () => {
  it("authorizes the batch and its obligations, opens the guard run once, and a repeat does nothing more", async () => {
    const { c, run, obs } = await setup();
    const port = new FakePort();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    expect(await signBatch(payment(c), batchId, port)).toEqual({ batchId, status: "OPEN" });
    const b = (await admin.from("payment_batches").select("status, authorizer_id, guard_run_key").eq("id", batchId).single()).data!;
    expect(b).toEqual({ status: "OPEN", authorizer_id: c.payment.id, guard_run_key: keccak256(toHex(batchId)) });
    for (const o of obs) expect((await admin.from("obligations").select("status, batch_id").eq("id", o.id).single()).data).toEqual({ status: "AUTHORIZED", batch_id: batchId });
    expect(await status("payroll_runs", run.runId)).toBe("PAYMENT_IN_PROGRESS");
    expect(port.opened).toBe(1);
    expect(await signBatch(payment(c), batchId, port)).toEqual({ batchId, status: "OPEN" });
    expect(port.opened).toBe(1);
  });

  it("the payroll approver cannot sign their own run, even holding the payment role (rule 18)", async () => {
    const { c, run } = await setup();
    await admin.from("memberships").update({ roles: ["PAYROLL_APPROVER", "PAYMENT_APPROVER"] }).eq("user_id", c.payroll.id).eq("company_id", c.id);
    const who = { companyId: c.id, userId: c.payroll.id, roles: ["PAYROLL_APPROVER", "PAYMENT_APPROVER"] as never };
    const { batchId } = await proposeBatch(who, run.runId, []);
    const port = new FakePort();
    await expect(signBatch(who, batchId, port)).rejects.toMatchObject({ code: "FOUR_EYES" });
    expect(await status("payment_batches", batchId)).toBe("PROPOSED");
    expect(port.opened).toBe(0);
  });

  it("a held obligation stays held through the signature; a new signed batch releases it (rule 24)", async () => {
    const { c, run, obs } = await setup();
    const port = new FakePort();
    const first = await proposeBatch(payment(c), run.runId, [obs[0].id]);
    await signBatch(payment(c), first.batchId, port);
    expect((await admin.from("obligations").select("status, batch_id").eq("id", obs[0].id).single()).data).toEqual({ status: "ON_HOLD", batch_id: null });
    await step(runStore, runMachine, c, run.runId, ["mark_partially_settled"]); // the first batch ran; slice 3 does this on settlement

    const release = await admin.from("obligations").update({ status: "AUTHORIZED" }).eq("id", obs[0].id); // not through a signed batch
    expect(release.error).not.toBeNull();
    const second = await proposeBatch(payment(c), run.runId, []);
    await signBatch(payment(c), second.batchId, port);
    expect((await admin.from("obligations").select("status, batch_id").eq("id", obs[0].id).single()).data).toEqual({ status: "AUTHORIZED", batch_id: second.batchId });
    expect(port.opened).toBe(2);
  });

  it("is refused when the treasury is short, live payments are off, or a recipient changed after the plan; nothing is authorized", async () => {
    const { c, run, obs } = await setup();
    const port = new FakePort();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    port.balance = 1n;
    await expect(signBatch(payment(c), batchId, port)).rejects.toMatchObject({ code: "TREASURY_SHORT" });
    port.balance = 1_000_000_000_000_000_000n;

    await changeRecipient({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, obs[0].worker_id, ADDR(0xbeef));
    await expect(signBatch(payment(c), batchId, port)).rejects.toMatchObject({ code: "RECIPIENT_NOT_CONFIRMED" });

    await admin.from("companies").update({ live_payments_enabled: false }).eq("id", c.id);
    await expect(signBatch(payment(c), batchId, port)).rejects.toMatchObject({ code: "LIVE_PAYMENTS_DISABLED" });
    expect(await status("payment_batches", batchId)).toBe("PROPOSED");
    for (const o of obs) expect(await status("obligations", o.id)).toBe("CREATED");
    expect(await status("payroll_runs", run.runId)).toBe("OBLIGATIONS_CREATED");
    expect(port.opened).toBe(0);
  });

  it("a signed batch whose guard run failed to open resumes without signing again; an already-open run is not opened twice", async () => {
    const { c, run } = await setup();
    const port = new FakePort();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    port.failOpen = true;
    await expect(signBatch(payment(c), batchId, port)).rejects.toThrow("circle is down");
    expect(await status("payment_batches", batchId)).toBe("AUTHORIZED");
    expect(await status("payroll_runs", run.runId)).toBe("PAYMENT_IN_PROGRESS");
    port.failOpen = false;
    expect(await openBatch(payment(c), batchId, port)).toEqual({ batchId, status: "OPEN" });
    expect(port.opened).toBe(1);

    const other = await setup(); // the chain already holds the run (crash after the transaction, before the DB write)
    const p2 = new FakePort();
    const b2 = await proposeBatch(payment(other.c), other.run.runId, []);
    p2.failOpen = true;
    await expect(signBatch(payment(other.c), b2.batchId, p2)).rejects.toThrow();
    for (const o of other.obs) p2.committed.set((await admin.from("obligations").select("onchain_key").eq("id", o.id).single()).data!.onchain_key, p2.runKeyFor(b2.batchId));
    expect(await openBatch(payment(other.c), b2.batchId, p2)).toEqual({ batchId: b2.batchId, status: "OPEN" });
    expect(p2.opened).toBe(0);
  });

  it("is refused when a payment is above the per-payment ceiling, before anything is committed", async () => {
    const { c, run } = await setup();
    const port = new FakePort();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    await admin.from("companies").update({ per_payment_ceiling: 1_000_000 }).eq("id", c.id);
    await expect(signBatch(payment(c), batchId, port)).rejects.toMatchObject({ code: "PLAN_INVALID" });
    expect(await status("payment_batches", batchId)).toBe("PROPOSED");
    expect(port.opened).toBe(0);
  });

  it("a discarded proposal cannot be signed", async () => {
    const { c, run } = await setup();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    expect(await discardBatch(payment(c), batchId)).toBe("DISCARDED");
    await expect(signBatch(payment(c), batchId, new FakePort())).rejects.toThrow(TransitionError);
  });
});

describe("S16 on the signing route", () => {
  it("needs the password and the payment role", async () => {
    const { c, run } = await setup();
    const { batchId } = await proposeBatch(payment(c), run.runId, []);
    const path = `/api/batches/${batchId}/sign`;
    const pay = (await cookieFor(c.payment)).cookie;
    expect((await call(signRoute, { cookie: pay, path, body: { password: "wrong" } }, withId(batchId))).status).toBe(401);
    expect((await call(signRoute, { cookie: (await cookieFor(c.payroll)).cookie, path, body: { password: c.payroll.password } }, withId(batchId))).status).toBe(403);
    expect(await status("payment_batches", batchId)).toBe("PROPOSED");
  });
});
