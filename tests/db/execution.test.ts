// P4 slice 3: paying a signed batch, recovery after a crash, the Circle webhook hint, closing a batch (rules 20-27, S05, S27-S31, S33).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as webhookRoute } from "@/app/api/circle/webhook/route";
import { POST as executeRoute } from "@/app/api/batches/[id]/execute/route";
import { payObligation } from "@/core/payments/agent";
import { AuthError } from "@/server/auth/session";
import { approveRun } from "@/server/db/approval";
import { proposeBatch, signBatch } from "@/server/db/batches";
import { assertRecoverRate, closeAllOpen, closeBatch, executeBatch, onCircleNotification, recoverPayments } from "@/server/payments/execute";
import { admin, call, cookieFor, makeCompany, pendingRun, withId, type TestCompany } from "./helpers";
import { agentDepsFor, DbChain, DbRail, FakePort } from "./payment-fakes";

const payroll = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles });
const payment = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });
const status = async (table: string, id: string) => (await admin.from(table).select("status").eq("id", id).single()).data!.status;

/** A LIVE company, a two-worker run taken to a signed, OPEN batch on the fake chain. */
async function openBatchFixture(script: ConstructorParameters<typeof DbRail>[1] = "OK") {
  const c = await makeCompany({ live: true });
  const run = await pendingRun(c, undefined, 1, 1);
  await approveRun(payroll(c), run.runId);
  const { batchId } = await proposeBatch(payment(c), run.runId, []);
  const port = new FakePort();
  await signBatch(payment(c), batchId, port);
  const chain = new DbChain();
  await chain.commitBatch(batchId);
  const rail = new DbRail(chain, script);
  const obs = (await admin.from("obligations").select("id, status, tx_hash, onchain_key").eq("batch_id", batchId).order("id")).data!;
  return { c, run, batchId, port, chain, rail, deps: agentDepsFor(chain, rail), obs };
}

describe("executing a batch", () => {
  it("pays every obligation through the gate, settles from the receipt and rolls the batch and run up to RECONCILED", async () => {
    const t = await openBatchFixture();
    const out = await executeBatch(payment(t.c), t.batchId, { deps: t.deps });
    expect(out).toMatchObject({ status: "OPEN", settled: 2, failed: 0, remaining: 0 });
    for (const o of t.obs) expect((await admin.from("obligations").select("status, tx_hash").eq("id", o.id).single()).data).toMatchObject({ status: "SETTLED", tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(await status("payment_batches", t.batchId)).toBe("COMPLETED");
    expect(await status("payroll_runs", t.run.runId)).toBe("RECONCILED");
    expect(t.rail.sends).toBe(2);
    expect((await admin.from("payment_attempts").select("state").eq("company_id", t.c.id)).data!.map((a) => a.state)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(await executeBatch(payment(t.c), t.batchId, { deps: t.deps })).toMatchObject({ status: "COMPLETED" });
    expect(t.rail.sends).toBe(2); // a repeat pays nothing
  });

  it("stops starting new payments when its time budget is used and continues on the next call", async () => {
    const t = await openBatchFixture();
    expect(await executeBatch(payment(t.c), t.batchId, { deps: t.deps, budgetMs: -1 })).toMatchObject({ settled: 1, remaining: 1 });
    expect(await status("payroll_runs", t.run.runId)).toBe("PAYMENT_IN_PROGRESS");
    expect(await status("payment_batches", t.batchId)).toBe("OPEN");
    expect(await executeBatch(payment(t.c), t.batchId, { deps: t.deps })).toMatchObject({ settled: 1, remaining: 0 });
    expect(await status("payroll_runs", t.run.runId)).toBe("RECONCILED");
    expect(t.rail.sends).toBe(2);
  });

  it("a payment Circle fails becomes an exception: the run is PAYMENT_FAILED, the batch stays open, closing returns the balance", async () => {
    const t = await openBatchFixture();
    t.rail.failKeys.add(t.obs[1].onchain_key);
    expect(await executeBatch(payment(t.c), t.batchId, { deps: t.deps })).toMatchObject({ settled: 1, failed: 1 });
    expect(await status("obligations", t.obs[0].id)).toBe("SETTLED");
    expect(await status("obligations", t.obs[1].id)).toBe("PAYMENT_EXCEPTION");
    expect(await status("payroll_runs", t.run.runId)).toBe("PAYMENT_FAILED");
    expect(await status("payment_batches", t.batchId)).toBe("OPEN");
    expect(t.rail.submits).toBe(2); // never retried

    expect(await closeBatch(payment(t.c), t.batchId, t.port)).toEqual({ batchId: t.batchId, status: "CLOSED" });
    expect(t.port.closed).toEqual([t.batchId]);
    await expect(executeBatch(payment(t.c), t.batchId, { deps: t.deps })).rejects.toThrow();
  });

  it("with live payments off nothing is paid, but a batch can still be closed", async () => {
    const t = await openBatchFixture();
    await admin.from("companies").update({ live_payments_enabled: false }).eq("id", t.c.id);
    await expect(executeBatch(payment(t.c), t.batchId, { deps: t.deps })).rejects.toMatchObject({ code: "LIVE_PAYMENTS_DISABLED" });
    expect(t.rail.submits).toBe(0);
    expect(await closeBatch(payment(t.c), t.batchId, t.port)).toMatchObject({ status: "CLOSED" });
    for (const o of t.obs) expect(await status("obligations", o.id)).toBe("PAYMENT_EXCEPTION"); // a closed run can no longer pay them
  });

  it("the kill-switch emergency path closes every open run, and leaves one with a payment in flight alone", async () => {
    const a = await openBatchFixture();
    const b = await openBatchFixture("THROW_AFTER_SEND");
    await payObligation(b.obs[0].id, b.deps); // b has a payment in flight (PAYING)
    expect(await closeAllOpen(a.c.id, { id: "script", type: "script" }, a.port)).toEqual({ closed: [a.batchId], skipped: [] });
    expect(await status("payment_batches", a.batchId)).toBe("CLOSED");
    expect(await closeAllOpen(b.c.id, { id: "script", type: "script" }, b.port)).toEqual({ closed: [], skipped: [b.batchId] });
    expect(await status("payment_batches", b.batchId)).toBe("OPEN");
    expect(b.port.closed).toEqual([]);
  });

  it("only a payment approver runs payments, and the route needs that role", async () => {
    const t = await openBatchFixture();
    await expect(executeBatch(payroll(t.c), t.batchId, { deps: t.deps })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const path = `/api/batches/${t.batchId}/execute`;
    expect((await call(executeRoute, { cookie: (await cookieFor(t.c.payroll)).cookie, path }, withId(t.batchId))).status).toBe(403);
    expect(t.rail.submits).toBe(0);
  });
});

describe("S29 recovery after a crash", () => {
  it("a payment that went through but was never recorded is settled from Arc, once, and the run completes", async () => {
    const t = await openBatchFixture("THROW_AFTER_SEND");
    expect(await payObligation(t.obs[0].id, t.deps)).toEqual({ status: "UNKNOWN" });
    expect(await status("obligations", t.obs[0].id)).toBe("PAYING");
    t.rail.script = "OK";
    await executeBatch(payment(t.c), t.batchId, { deps: t.deps }); // pays the second; leaves the PAYING one to recovery
    expect(await status("payroll_runs", t.run.runId)).toBe("PAYMENT_IN_PROGRESS");

    expect(await recoverPayments(t.c.id, { deps: t.deps })).toEqual({ checked: 0, settled: 0 }); // too fresh to be considered stuck
    expect(await recoverPayments(t.c.id, { deps: t.deps, olderThanMs: -1 })).toEqual({ checked: 1, settled: 1 });
    expect(await status("obligations", t.obs[0].id)).toBe("SETTLED");
    expect(await status("payment_batches", t.batchId)).toBe("COMPLETED");
    expect(await status("payroll_runs", t.run.runId)).toBe("RECONCILED");
    expect(t.rail.sends).toBe(2);
    expect(await recoverPayments(t.c.id, { deps: t.deps, olderThanMs: -1 })).toEqual({ checked: 0, settled: 0 });
  });
});

describe("S27 the Circle webhook is only a hint", () => {
  it("re-checks the one obligation it names, settles from Arc, and a replay changes nothing", async () => {
    const t = await openBatchFixture("PENDING_UNTIL_CONFIRMED");
    await executeBatch(payment(t.c), t.batchId, { deps: { ...t.deps, maxPolls: 1 }, budgetMs: -1 });
    const attempt = (await admin.from("payment_attempts").select("circle_tx_id, obligation_id").eq("company_id", t.c.id).single()).data!;
    expect(await status("obligations", attempt.obligation_id)).toBe("PAYING");

    expect(await onCircleNotification({ notificationId: "n-0", circleTxId: "unknown-tx" }, { deps: t.deps })).toEqual({ handled: false });
    t.rail.confirmed = true; // Circle now reports COMPLETE
    const n = { notificationId: `n-${randomUUID()}`, circleTxId: attempt.circle_tx_id };
    expect(await onCircleNotification(n, { deps: t.deps })).toEqual({ handled: true, outcome: "SETTLED" });
    expect(await status("obligations", attempt.obligation_id)).toBe("SETTLED");
    expect(await onCircleNotification(n, { deps: t.deps })).toEqual({ handled: false, duplicate: true });
    expect((await admin.from("webhook_notifications").select("id").eq("company_id", t.c.id)).data).toHaveLength(1);
    expect(t.rail.sends).toBe(1);
  });

  it("the route refuses a missing or invalid signature and an oversized body, and stores nothing", async () => {
    const path = "/api/circle/webhook";
    const before = (await admin.from("webhook_notifications").select("id", { count: "exact", head: true })).count;
    const body = { notificationId: "x", notificationType: "transactions.outbound", notification: { id: "c-1" } };
    expect((await call(webhookRoute, { path, body, origin: null })).status).toBe(401);
    expect((await call(webhookRoute, { path, body: { pad: "x".repeat(20_000) }, origin: null })).status).toBe(413);
    expect((await admin.from("webhook_notifications").select("id", { count: "exact", head: true })).count).toBe(before);
  });
});

describe("S31 recovery rate limit", () => {
  it("a sixth recovery call within a minute is refused", async () => {
    const c = await makeCompany({ live: true });
    for (let i = 0; i < 6; i++) await admin.from("audit_events").insert({ company_id: c.id, event: "payments.recover", entity_type: "company", entity_id: c.id, actor: c.payment.id });
    await expect(assertRecoverRate(c.id)).rejects.toBeInstanceOf(AuthError);
    const other = await makeCompany({ live: true });
    await expect(assertRecoverRate(other.id)).resolves.toBeUndefined();
  });
});
