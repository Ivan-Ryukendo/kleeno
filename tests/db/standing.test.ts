// P4b acceptance: standing grants are re-authenticated, company-scoped and re-evaluated against real settled history.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as standingRoute } from "@/app/api/standing-authorizations/route";
import { runMachine, type RunState } from "@/core/domain/machines";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { computePlanHash, type PlanInput } from "@/core/payments/plan-hash";
import { approveRun } from "@/server/db/approval";
import { saveCalculation } from "@/server/db/calculations";
import { proposeBatch, signBatch, tryStandingBatch } from "@/server/db/batches";
import { runStore } from "@/server/db/runs";
import { createStanding, revokeStanding, standingFailures } from "@/server/db/standing";
import { executeBatch } from "@/server/payments/execute";
import { admin, call, cookieFor, makeCompany, pendingRun, step, type TestCompany } from "./helpers";
import { agentDepsFor, DbChain, DbRail, FakePort } from "./payment-fakes";

const payroll = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles });
const payment = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });
const grantInput = { maxBatchTotal: "10000000", maxPerPayment: "5000000", expiresAt: "2030-01-01T00:00:00.000Z" };

function plannerFor(ids: string[]) {
  return {
    name: "standing-db-test",
    async complete() {
      return { text: JSON.stringify({ order: ids, holds: [], flags: [], rationale: "I propose the listed order for human review." }), model: "test-model" };
    },
  };
}

async function nextRunForSameWorkers(c: TestCompany, previous: Awaited<ReturnType<typeof pendingRun>>) {
  const inserted = await admin.from("payroll_runs").insert({
    company_id: c.id,
    mode: "LIVE_TESTNET",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    config_version: previous.config.version,
    created_by: c.payroll.id,
  }).select("id").single();
  if (inserted.error) throw new Error(`run insert failed: ${inserted.error.message}`);
  const runId = inserted.data.id;
  await step<RunState>(runStore, runMachine, c, runId, ["import_data", "start_reconciliation", "finish_reconciliation", "calculate"]);
  const entries: EngineEntry[] = previous.workers.map(({ workerId }) => ({
    worker: { workerId, payType: "SALARIED", baseAmount: parseUsdc("1234567.891011"), hourlyRate: 0n },
    input: { workedHours: "160" },
  }));
  const calc = calculatePayroll(previous.config, entries);
  await saveCalculation(c.id, runId, previous.config, entries, calc);
  await step<RunState>(runStore, runMachine, c, runId, ["validate_calculation", "submit_for_approval"]);
  await approveRun(payroll(c), runId);
  return { runId };
}

async function settleFirstRun(c: TestCompany, fixture: Awaited<ReturnType<typeof pendingRun>>) {
  const { batchId } = await proposeBatch(payment(c), fixture.runId, []);
  const port = new FakePort();
  await signBatch(payment(c), batchId, port);
  const chain = new DbChain();
  await chain.commitBatch(batchId);
  const rail = new DbRail(chain);
  const result = await executeBatch(payment(c), batchId, { deps: agentDepsFor(chain, rail) });
  expect(result).toMatchObject({ settled: fixture.workers.length, failed: 0, remaining: 0 });
}

function inputPlan(stored: { plan: { obligations: { id: string; amount: string; recipient: string }[]; heldIds: string[]; source: string } }): PlanInput {
  return {
    obligations: stored.plan.obligations.map((o) => ({ ...o, amount: BigInt(o.amount) })),
    heldIds: stored.plan.heldIds,
    source: stored.plan.source,
  };
}

describe("standing authorization acceptance", () => {
  it("requires the payment role and password to create; revocation needs no password and is audited", async () => {
    const c = await makeCompany({ live: true });
    const path = "/api/standing-authorizations";
    const body = { action: "create", ...grantInput, password: c.payment.password };
    const payCookie = (await cookieFor(c.payment)).cookie;
    const payrollCookie = (await cookieFor(c.payroll)).cookie;

    expect((await call(standingRoute, { cookie: payrollCookie, path, body })).status).toBe(403);
    expect((await call(standingRoute, { cookie: payCookie, path, body: { ...body, password: "wrong" } })).status).toBe(401);
    const created = await call(standingRoute, { cookie: payCookie, path, body });
    expect(created.status).toBe(200);
    const grant = await created.json() as { id: string; created_by: string };
    expect(grant.created_by).toBe(c.payment.id);

    const revoked = await call(standingRoute, { cookie: payCookie, path, body: { action: "revoke", id: grant.id } });
    expect(revoked.status).toBe(200);
    expect((await admin.from("standing_authorizations").select("revoked_at, revoked_by").eq("id", grant.id).single()).data).toMatchObject({ revoked_by: c.payment.id });
    const audit = (await admin.from("audit_events").select("event, entity_id").eq("company_id", c.id).in("event", ["standing.created", "standing.revoked"])).data!;
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "standing.created", entity_id: grant.id }),
      expect.objectContaining({ event: "standing.revoked", entity_id: grant.id }),
    ]));
  });

  it("binds accepted planner evidence to a run, refuses unsafe context, and opens only a clean standing batch", async () => {
    const c = await makeCompany({ live: true });
    const first = await pendingRun(c, undefined, 20, 1);
    await approveRun(payroll(c), first.runId);
    const firstIds = (await admin.from("obligations").select("id").eq("run_id", first.runId).order("id")).data?.map((o) => o.id) ?? [];
    const standing = await createStanding(payment(c), grantInput);
    const initial = await proposeBatch(payment(c), first.runId, [], { planner: true, provider: plannerFor(firstIds), port: new FakePort() });
    expect(initial.source).not.toBe("FALLBACK");
    const initialRow = (await admin.from("payment_batches").select("plan, plan_hash").eq("id", initial.batchId).single()).data!;
    const initialPlan = inputPlan(initialRow);
    const firstFailures = await standingFailures({ companyId: c.id, runId: first.runId, standingId: standing.id, authorizerId: c.payment.id, plan: initialPlan, planHash: initialRow.plan_hash });
    expect(firstFailures).toContain("CONFIG_VERSION_CHANGED"); // no previous settled run exists yet

    const heldPlan: PlanInput = {
      ...initialPlan,
      obligations: initialPlan.obligations.slice(0, 1),
      heldIds: [...initialPlan.heldIds, initialPlan.obligations[1].id],
    };
    const heldFailures = await standingFailures({ companyId: c.id, runId: first.runId, standingId: standing.id, authorizerId: c.payment.id, plan: heldPlan, planHash: computePlanHash(heldPlan) });
    expect(heldFailures).toContain("HAS_HOLDS");

    await settleFirstRun(c, first);
    const next = await nextRunForSameWorkers(c, first);
    const nextIds = (await admin.from("obligations").select("id").eq("run_id", next.runId).order("id")).data!.map((o) => o.id);
    const proposal = await proposeBatch(payment(c), next.runId, [], { planner: true, provider: plannerFor(nextIds), port: new FakePort() });
    const stored = (await admin.from("payment_batches").select("plan, plan_hash, status").eq("id", proposal.batchId).single()).data!;
    const plan = inputPlan(stored);
    const execution = (await admin.from("ai_executions").select("id, status, operation, input_ref").eq("id", stored.plan.source).single()).data!;
    expect(execution).toMatchObject({ status: "ACCEPTED", operation: "PAYMENT_PLAN", input_ref: next.runId });

    expect(await standingFailures({ companyId: c.id, runId: next.runId, standingId: standing.id, authorizerId: c.payment.id, plan, planHash: stored.plan_hash })).toEqual([]);
    expect(await standingFailures({ companyId: c.id, runId: next.runId, standingId: standing.id, authorizerId: c.payment.id, plan, planHash: "0".repeat(64) })).toContain("PLAN_INVALID");
    const missingExecution = { ...plan, source: randomUUID() };
    expect(await standingFailures({ companyId: c.id, runId: next.runId, standingId: standing.id, authorizerId: c.payment.id, plan: missingExecution, planHash: computePlanHash(missingExecution) })).toContain("PLANNER_EXECUTION_INVALID");

    await revokeStanding(payment(c), standing.id);
    expect(await standingFailures({ companyId: c.id, runId: next.runId, standingId: standing.id, authorizerId: c.payment.id, plan, planHash: stored.plan_hash })).toContain("REVOKED");

    const active = await createStanding(payment(c), grantInput);
    await admin.from("memberships").update({ roles: ["PAYROLL_APPROVER"] }).eq("company_id", c.id).eq("user_id", c.payment.id);
    expect(await standingFailures({ companyId: c.id, runId: next.runId, standingId: active.id, authorizerId: c.payment.id, plan, planHash: stored.plan_hash })).toContain("CREATOR_ROLE_REMOVED");
    await admin.from("memberships").update({ roles: ["PAYMENT_APPROVER"] }).eq("company_id", c.id).eq("user_id", c.payment.id);

    const opened = await tryStandingBatch(payment(c), proposal.batchId, new FakePort());
    expect(opened).toEqual({ authorized: true, status: "OPEN" });
    const batch = (await admin.from("payment_batches").select("status, authorizer_id, authorization_type, standing_authorization_id").eq("id", proposal.batchId).single()).data!;
    expect(batch).toMatchObject({ status: "OPEN", authorizer_id: c.payment.id, authorization_type: "STANDING", standing_authorization_id: active.id });
    const audit = (await admin.from("audit_events").select("entity_id, event").eq("company_id", c.id).eq("entity_type", "batch").eq("entity_id", proposal.batchId)).data!;
    expect(audit.map((row) => row.event)).toContain("batch.authorize");
  });
});
