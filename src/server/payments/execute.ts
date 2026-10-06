import "server-only";
import { auditEvent, newCorrelationId, type ActorType } from "@/core/audit";
import { batchMachine, runMachine, TransitionError, type BatchState, type RunState } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { payObligation, resumeObligation, type AgentDeps } from "@/core/payments/agent";
import { batchComplete, runOutcome } from "@/core/payments/rollup";
import type { ObligationStatus } from "@/core/ports";
import { isPaymentRole, WorkflowError, type Role } from "@/core/workflow";
import { ARC_CHAIN_ID, arcChainReader, USDC_ADDRESS } from "@/server/arc/reader";
import { AuthError } from "@/server/auth/session";
import { writeAudit } from "@/server/db/audit";
import { assertLive, ownerPort, type OwnerPort } from "@/server/db/batches";
import { db, must } from "@/server/db/client";
import { paymentsRepo } from "@/server/db/payments-repo";
import { runStore } from "@/server/db/runs";
import { dbStore } from "@/server/db/store";
import { arcUsdcRail } from "@/server/rails/arc-usdc-rail";

// The payment agent's server wiring (rules 20-22, 26): runs an OPEN batch obligation by obligation, recovers payments a crash
// left PAYING, and rolls the results up to the batch and the run. It never decides a state from a request or a webhook payload.
const batches = dbStore<BatchState>("payment_batches");
const SYSTEM = { id: "payment-agent", type: "agent" as ActorType };

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}
type Actor = { id: string; type: ActorType };

/** The agent wallet, the guard and the real clock for one company. Tests pass their own `AgentDeps`. */
export async function agentDeps(companyId: string, correlationId = newCorrelationId()): Promise<AgentDeps> {
  const co = must(await db().from("companies").select("guard_address").eq("id", companyId).single(), "company read");
  const wallet = (await db().from("company_wallets").select("circle_wallet_id").eq("company_id", companyId).eq("role", "AGENT").maybeSingle()).data;
  if (!co.guard_address || !wallet) throw new WorkflowError("NOT_PROVISIONED", "this company has no agent wallet and guard yet");
  return {
    repo: paymentsRepo(correlationId),
    chain: arcChainReader(co.guard_address),
    rail: arcUsdcRail({ agentWalletId: wallet.circle_wallet_id, guardAddress: co.guard_address }),
    clock: { now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    expect: { chainId: ARC_CHAIN_ID, guardAddress: co.guard_address, usdcAddress: USDC_ADDRESS },
  };
}

async function loadBatch(companyId: string, batchId: string) {
  const b = (await db().from("payment_batches").select("id, run_id, status, plan").eq("id", batchId).eq("company_id", companyId).maybeSingle()).data;
  if (!b) throw new TransitionError("NOT_FOUND", "batch not found");
  return { id: b.id as string, runId: b.run_id as string, status: b.status as BatchState, ids: (b.plan.obligations as { id: string }[]).map((o) => o.id) };
}

const statuses = async (companyId: string, ids: string[]) => must(await db().from("obligations").select("id, status").eq("company_id", companyId).in("id", ids), "obligations read") as { id: string; status: ObligationStatus }[];

/** Batch -> COMPLETED when everything in it settled; run -> SETTLED -> RECONCILED, PARTIALLY_SETTLED or PAYMENT_FAILED once nothing is moving. Safe to call any time. */
export async function rollUp(companyId: string, batchId: string, actor: Actor, correlationId: string): Promise<void> {
  try {
    await rollUpOnce(companyId, batchId, actor, correlationId);
  } catch (e) {
    // The webhook and the executor can roll the same batch up at once; the loser re-reads and finds the work done.
    if (!(e instanceof TransitionError && e.code === "STALE_STATE")) throw e;
    await rollUpOnce(companyId, batchId, actor, correlationId);
  }
}

async function rollUpOnce(companyId: string, batchId: string, actor: Actor, correlationId: string) {
  const batch = await loadBatch(companyId, batchId);
  if (batch.status === "OPEN" && batchComplete((await statuses(companyId, batch.ids)).map((o) => o.status))) {
    await applyTransition(batches, batchMachine, { id: batch.id, companyId, action: "complete", actor: actor.id, actorType: actor.type, correlationId });
  }
  const run = (await db().from("payroll_runs").select("status").eq("id", batch.runId).eq("company_id", companyId).single()).data;
  if ((run?.status as RunState) !== "PAYMENT_IN_PROGRESS") return;
  const outcome = runOutcome(must(await db().from("obligations").select("status").eq("company_id", companyId).eq("run_id", batch.runId), "run obligations read").map((o) => o.status as ObligationStatus));
  if (outcome === "IN_PROGRESS") return;
  const action = { SETTLED: "mark_settled", PAYMENT_FAILED: "mark_payment_failed", PARTIALLY_SETTLED: "mark_partially_settled" }[outcome];
  await applyTransition(runStore, runMachine, { id: batch.runId, companyId, action, actor: actor.id, actorType: actor.type, correlationId, refs: { batchId } });
  if (outcome === "SETTLED") await applyTransition(runStore, runMachine, { id: batch.runId, companyId, action: "reconcile", actor: actor.id, actorType: actor.type, correlationId });
}

function requirePaymentRole(who: Who) {
  if (!isPaymentRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only a payment approver runs payments");
}

/**
 * Pays the batch's AUTHORIZED obligations in plan order, one at a time, through the gate. Stops starting new ones once `budgetMs`
 * is used (a serverless request has a time limit); call it again to continue. Obligations already PAYING are left to recovery.
 */
export async function executeBatch(who: Who, batchId: string, o: { deps?: AgentDeps; budgetMs?: number } = {}) {
  requirePaymentRole(who);
  const correlationId = who.correlationId ?? newCorrelationId();
  const batch = await loadBatch(who.companyId, batchId);
  if (batch.status === "COMPLETED") return { status: "COMPLETED" as const, settled: 0, failed: 0, remaining: 0, inFlight: 0 };
  if (batch.status !== "OPEN") throw new TransitionError("INVALID_TRANSITION", `a ${batch.status} batch cannot be paid`);
  await assertLive(who.companyId);
  const deps = o.deps ?? (await agentDeps(who.companyId, correlationId));
  const start = Date.now();
  const tally = { settled: 0, failed: 0, remaining: 0, inFlight: 0 };
  let attempted = 0;
  let stopped = false;
  for (const id of batch.ids) {
    const row = (await statuses(who.companyId, [id]))[0];
    if (row.status === "PAYING") tally.inFlight++;
    if (row.status !== "AUTHORIZED") continue;
    if (stopped || (attempted > 0 && Date.now() - start > (o.budgetMs ?? 40_000))) {
      stopped = true;
      tally.remaining++;
      continue;
    }
    attempted++;
    const out = await payObligation(id, deps);
    if (out.status === "SETTLED") tally.settled++;
    else if (out.status === "PENDING" || out.status === "UNKNOWN") tally.inFlight++;
    else tally.failed++;
  }
  await rollUp(who.companyId, batchId, { id: who.userId, type: "user" }, correlationId);
  return { status: "OPEN" as const, ...tally };
}

/** Recovers PAYING obligations of one company that are older than `olderThanMs`, then rolls their batches up. Arc decides (S29). */
export async function recoverPayments(companyId: string, o: { olderThanMs?: number; deps?: AgentDeps; actor?: Actor; correlationId?: string } = {}) {
  const correlationId = o.correlationId ?? newCorrelationId();
  const cutoff = new Date(Date.now() - (o.olderThanMs ?? 120_000)).toISOString();
  const stuck = must(await db().from("obligations").select("id, batch_id").eq("company_id", companyId).eq("status", "PAYING").lt("updated_at", cutoff), "stuck read");
  // A crash after the last payment settled but before the roll-up leaves an OPEN batch with nothing PAYING (S29 point 6): roll those up too.
  const open = must(await db().from("payment_batches").select("id").eq("company_id", companyId).eq("status", "OPEN"), "open batches read").map((b) => b.id as string);
  if (stuck.length === 0) {
    for (const id of open) await rollUp(companyId, id, o.actor ?? SYSTEM, correlationId);
    return { checked: 0, settled: 0 };
  }
  const deps = o.deps ?? (await agentDeps(companyId, correlationId));
  let settled = 0;
  for (const s of stuck) if ((await resumeObligation(s.id, deps)).status === "SETTLED") settled++;
  for (const id of new Set([...stuck.map((s) => s.batch_id as string | null).filter((x): x is string => !!x), ...open])) await rollUp(companyId, id, o.actor ?? SYSTEM, correlationId);
  await writeAudit(auditEvent({ companyId, event: "payments.recovered", entityType: "company", entityId: companyId, actor: (o.actor ?? SYSTEM).id, actorType: (o.actor ?? SYSTEM).type, correlationId, refs: { checked: stuck.length, settled } }));
  return { checked: stuck.length, settled };
}

/** The recover route is open to every payment-side member, so cap it: six calls a minute per company (S36). */
export async function assertRecoverRate(companyId: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db().from("audit_events").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("event", "payments.recover").gte("created_at", since);
  if ((count ?? 0) >= 6) throw new AuthError(429, "THROTTLED", "recovery was just run; wait a minute");
}

/**
 * A Circle webhook says a transaction changed. It is a hint: find the attempt it belongs to, remember the notification once, and re-check
 * Circle and Arc for that one obligation. Unknown transactions are ignored. Nothing in the payload becomes state.
 */
export async function onCircleNotification(n: { notificationId: string; circleTxId: string }, o: { deps?: AgentDeps; correlationId?: string } = {}) {
  const correlationId = o.correlationId ?? newCorrelationId();
  const attempt = (await db().from("payment_attempts").select("obligation_id, company_id").eq("circle_tx_id", n.circleTxId).maybeSingle()).data;
  if (!attempt) return { handled: false as const };
  const seen = (await db().from("webhook_notifications").select("id").eq("provider", "circle").eq("notification_id", n.notificationId).maybeSingle()).data;
  if (seen) return { handled: false as const, duplicate: true as const }; // replay or retry of one already processed: nothing to do
  const deps = o.deps ?? (await agentDeps(attempt.company_id, correlationId));
  const out = await resumeObligation(attempt.obligation_id, deps);
  const ob = (await db().from("obligations").select("batch_id").eq("id", attempt.obligation_id).maybeSingle()).data;
  if (ob?.batch_id) await rollUp(attempt.company_id, ob.batch_id, SYSTEM, correlationId);
  // Remembered only after success, so a failure returns 500 and Circle's retry is processed. Two deliveries racing both run; re-checking is idempotent (Arc decides).
  const saved = await db().from("webhook_notifications").insert({ company_id: attempt.company_id, provider: "circle", notification_id: n.notificationId, circle_tx_id: n.circleTxId }).select("id");
  if (saved.error && saved.error.code !== "23505") throw new Error("webhook insert failed");
  return { handled: true as const, outcome: out.status };
}

/**
 * Closes an OPEN batch: the guard returns the unpaid balance to the approver wallet and unpaid obligations become exceptions (a closed
 * run can no longer pay them). Refused while a payment is in flight. Only reduces authority, so it needs no re-auth and works with live payments off.
 */
export async function closeBatch(who: Who, batchId: string, port?: OwnerPort) {
  requirePaymentRole(who);
  return closeOpen(who.companyId, { id: who.userId, type: "user" }, batchId, who.correlationId ?? newCorrelationId(), port);
}

async function closeOpen(companyId: string, actor: Actor, batchId: string, correlationId: string, port?: OwnerPort) {
  const batch = await loadBatch(companyId, batchId);
  if (batch.status !== "OPEN") throw new TransitionError("INVALID_TRANSITION", `a ${batch.status} batch cannot be closed`);
  const rows = await statuses(companyId, batch.ids);
  if (rows.some((r) => r.status === "PAYING")) throw new TransitionError("INVALID_TRANSITION", "a payment is in flight; recover it before closing");
  await (port ?? (await ownerPort(companyId))).closeRun(batchId);
  const repo = paymentsRepo();
  for (const r of rows) if (r.status === "AUTHORIZED") await repo.markException(r.id, "BATCH_CLOSED", [], "AUTHORIZED");
  await applyTransition(batches, batchMachine, { id: batchId, companyId, action: "close", actor: actor.id, actorType: actor.type, correlationId });
  await rollUp(companyId, batchId, actor, correlationId);
  return { batchId, status: "CLOSED" as const };
}

/** Emergency path for the kill switch (`scripts/live-payments.ts --close-open-runs`): closes every OPEN batch of a company and returns the funds. Batches with a payment in flight are reported, not closed. */
export async function closeAllOpen(companyId: string, actor: Actor, port?: OwnerPort) {
  const open = must(await db().from("payment_batches").select("id").eq("company_id", companyId).eq("status", "OPEN"), "open batches read");
  const closed: string[] = [];
  const skipped: string[] = [];
  for (const b of open) {
    try {
      await closeOpen(companyId, actor, b.id, newCorrelationId(), port);
      closed.push(b.id);
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e;
      skipped.push(b.id);
    }
  }
  return { closed, skipped };
}
