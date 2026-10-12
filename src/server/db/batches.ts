import "server-only";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { batchMachine, obligationMachine, TransitionError, type BatchState, type ObligationState, type RunState } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { buildFallbackPlan, checkPlan, PlanError, planTotal } from "@/core/payments/batches";
import type { PlanInput } from "@/core/payments/plan-hash";
import type { AiProvider } from "@/core/ai";
import type { GuardEntry } from "@/core/ports";
import { assertFourEyes, isPaymentRole, runAction, WorkflowError, type Role } from "@/core/workflow";
import { arcChainReader, USDC_ADDRESS, usdcBalanceOf } from "@/server/arc/reader";
import { closeRun, guardRunKey, openRun } from "@/server/circle/guard-owner";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { runStore } from "./runs";
import { loadSignals } from "./signals";
import { planPayments } from "@/server/ai/planner";
import { standingFailures } from "./standing";
import { dbStore } from "./store";

const obligations = dbStore<ObligationState>("obligations");
const batches = dbStore<BatchState>("payment_batches");

/** Arc gas is paid in USDC, so the approver wallet must hold the batch plus this reserve for the approve and openRun transactions. */
export const GAS_RESERVE = 500_000n; // 0.5 USDC; raise it if Arc fees grow

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
  actorType?: "user" | "system";
}

/** What the batch code needs from the chain and the approver wallet. Tests pass a fake; production uses `ownerPort`. */
export interface OwnerPort {
  usdcBalance(): Promise<bigint>;
  guardEntry(onchainKey: string): Promise<GuardEntry>;
  runKeyFor(batchId: string): string;
  openRun(batchId: string, obligations: { onchainKey: string; recipient: string; amount: bigint }[]): Promise<void>;
  /** Returns the batch's unpaid balance from the guard to the approver wallet. */
  closeRun(batchId: string): Promise<void>;
}

export async function ownerPort(companyId: string): Promise<OwnerPort> {
  const co = must(await db().from("companies").select("guard_address").eq("id", companyId).single(), "company read");
  const wallet = (await db().from("company_wallets").select("circle_wallet_id, address").eq("company_id", companyId).eq("role", "APPROVER").maybeSingle()).data;
  if (!co.guard_address || !wallet) throw new WorkflowError("NOT_PROVISIONED", "this company has no approver wallet and guard yet");
  const owner = { approverWalletId: wallet.circle_wallet_id, guardAddress: co.guard_address, usdcAddress: USDC_ADDRESS };
  const chain = arcChainReader(co.guard_address);
  return {
    usdcBalance: () => usdcBalanceOf(wallet.address),
    guardEntry: (key) => chain.guardEntry(key),
    runKeyFor: guardRunKey,
    openRun: async (batchId, obs) => void (await openRun(owner, batchId, obs)),
    closeRun: async (batchId) => void (await closeRun(owner, batchId)),
  };
}

export async function assertLive(companyId: string) {
  const live = must(await db().from("companies").select("live_payments_enabled").eq("id", companyId).single(), "company read");
  if (!live.live_payments_enabled) throw new WorkflowError("LIVE_PAYMENTS_DISABLED", "live payments are off for this company");
}

const PAYABLE_RUN: readonly RunState[] = ["OBLIGATIONS_CREATED", "PARTIALLY_SETTLED", "PAYMENT_FAILED"];

function requirePaymentRole(who: Who) {
  if (!isPaymentRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only a payment approver plans and signs payments");
}

async function loadRun(who: Who, runId: string) {
  const run = (await db().from("payroll_runs").select("id, mode, status").eq("id", runId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!run) throw new TransitionError("NOT_FOUND", "run not found");
  if (run.mode !== "LIVE_TESTNET") throw new WorkflowError("SIMULATION_CANNOT_PAY", "only a LIVE_TESTNET run is paid");
  return { ...run, status: run.status as RunState };
}

/** Unpaid obligations of a run: the ones a plan must account for. */
async function eligible(companyId: string, runId: string) {
  const rows = must(await db().from("obligations").select("id, worker_id, amount, recipient, status, onchain_key").eq("company_id", companyId).eq("run_id", runId).in("status", ["CREATED", "ON_HOLD"]), "obligations read");
  return rows.map((r) => ({ ...r, amount: BigInt(r.amount) }));
}

interface StoredBatch {
  id: string;
  run_id: string;
  status: BatchState;
  plan: { obligations: { id: string; amount: string; recipient: string }[]; heldIds: string[]; source: string };
  plan_hash: string;
  authorizer_id: string | null;
  authorization_type: "HUMAN" | "STANDING";
  standing_authorization_id: string | null;
}

async function loadBatch(who: Who, batchId: string) {
  const b = (await db().from("payment_batches").select("id, run_id, status, plan, plan_hash, authorizer_id, authorization_type, standing_authorization_id").eq("id", batchId).eq("company_id", who.companyId).maybeSingle()).data as StoredBatch | null;
  if (!b) throw new TransitionError("NOT_FOUND", "batch not found");
  const plan: PlanInput = { obligations: b.plan.obligations.map((o) => ({ ...o, amount: BigInt(o.amount) })), heldIds: b.plan.heldIds, source: b.plan.source };
  return { ...b, plan };
}

const obStep = (who: Who, correlationId: string, id: string, action: string) =>
  applyTransition(obligations, obligationMachine, { id, companyId: who.companyId, action, actor: who.userId, actorType: who.actorType ?? "user", correlationId });

/**
 * Builds the fallback plan for the run's unpaid obligations. Obligations in `holdIds` go on hold now (placing a hold only reduces
 * authority); held ones left out of `holdIds` are released into this batch, and that release takes effect only when it is signed.
 * Replaces any earlier proposal for the run. Signals are stored with the plan and never block by themselves (rule 25).
 */
export async function proposeBatch(who: Who, runId: string, holdIds: string[], options: { planner?: boolean; provider?: AiProvider; port?: OwnerPort; autoAuthorize?: boolean } = {}) {
  requirePaymentRole(who);
  const correlationId = who.correlationId ?? newCorrelationId();
  const run = await loadRun(who, runId);
  if (!PAYABLE_RUN.includes(run.status)) throw new TransitionError("INVALID_TRANSITION", `a run is planned after its obligations exist, not in ${run.status}`);
  const rows = await eligible(who.companyId, runId);
  const signals = await loadSignals(who.companyId, runId);
  let proposal: Awaited<ReturnType<typeof planPayments>>["proposal"] = null;
  let executionId: string | null = null;
  let owner = options.port;
  let built;
  try {
    built = buildFallbackPlan(rows, holdIds);
  } catch (e) {
    if (e instanceof PlanError) throw new WorkflowError("PLAN_INVALID", e.message);
    throw e;
  }
  if (options.planner) {
    try {
      owner ??= await ownerPort(who.companyId);
      const workers = must(await db().from("workers").select("id, pseudonym").eq("company_id", who.companyId).in("id", rows.map(r => r.worker_id)), "planner workers read");
      const codes = new Map(workers.map(w => [w.id, w.pseudonym]));
      const planned = await planPayments({ companyId: who.companyId, correlationId }, runId, rows.map(r => ({ ...r, workerRef: codes.get(r.worker_id) ?? "" })), signals, await owner.usdcBalance(), holdIds, options.provider);
      built = planned;
      proposal = planned.proposal;
      executionId = planned.executionId;
    } catch {
      // Planner setup or treasury-read failure only removes AI ordering; manual holds still apply to the signed fallback.
      built = buildFallbackPlan(rows, holdIds);
    }
  }
  for (const old of must(await db().from("payment_batches").select("id").eq("company_id", who.companyId).eq("run_id", runId).eq("status", "PROPOSED"), "proposals read")) {
    await applyTransition(batches, batchMachine, { id: old.id, companyId: who.companyId, action: "discard", actor: who.userId, actorType: "user", correlationId });
  }
  for (const r of rows) if (holdIds.includes(r.id) && r.status === "CREATED") await obStep(who, correlationId, r.id, "hold");
  const stored = { obligations: built.plan.obligations.map((o) => ({ ...o, amount: o.amount.toString() })), heldIds: built.plan.heldIds, source: built.plan.source, signals, proposal, executionId };
  const row = must(await db().from("payment_batches").insert({ company_id: who.companyId, run_id: runId, plan_hash: built.planHash, plan: stored }).select("id").single(), "batch insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "batch.proposed", entityType: "payment_batch", entityId: row.id, actor: who.userId, actorType: "user", correlationId, refs: { planHash: built.planHash, obligations: built.plan.obligations.length, held: built.plan.heldIds.length, signals: signals.length } }));
  const standing = options.autoAuthorize && built.plan.source !== "FALLBACK" ? await tryStandingBatch({ ...who, correlationId }, row.id, owner) : { authorized: false as const };
  return { batchId: row.id, planHash: built.planHash, total: planTotal(built.plan).toString(), held: built.plan.heldIds.length, signals, source: built.plan.source, proposal, ...standing };
}

export async function discardBatch(who: Who, batchId: string) {
  requirePaymentRole(who);
  return applyTransition(batches, batchMachine, { id: batchId, companyId: who.companyId, action: "discard", actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId() });
}

/** A clean accepted plan may use a standing grant; this never creates payment authority for fallback or held work. */
export async function tryStandingBatch(who: Who, batchId: string, port?: OwnerPort): Promise<{ authorized: boolean; status?: "OPEN"; reason?: string }> {
  requirePaymentRole(who);
  const correlationId = who.correlationId ?? newCorrelationId();
  const batch = await loadBatch(who, batchId);
  if (batch.status !== "PROPOSED" || batch.authorizer_id) return { authorized: false, reason: "BATCH_ALREADY_CLAIMED" };
  if (batch.plan.source === "FALLBACK" || batch.plan.heldIds.length) return { authorized: false, reason: "HUMAN_REVIEW_REQUIRED" };
  const run = await loadRun(who, batch.run_id);
  if (!PAYABLE_RUN.includes(run.status)) return { authorized: false, reason: "RUN_NOT_PAYABLE" };
  const rows = await eligible(who.companyId, batch.run_id);
  if (rows.some(r => r.status === "ON_HOLD") || checkPlan(batch.plan, batch.plan_hash, rows).length) return { authorized: false, reason: "PLAN_CHANGED_OR_HELD" };
  const candidates = must(await db().from("standing_authorizations").select("id, created_by").eq("company_id", who.companyId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }), "standing candidates read");
  for (const candidate of candidates) {
    const input = { companyId: who.companyId, runId: batch.run_id, standingId: candidate.id, authorizerId: candidate.created_by, plan: batch.plan, planHash: batch.plan_hash };
    if ((await standingFailures(input)).length) continue;
    const owner = port ?? await ownerPort(who.companyId);
    if (await owner.usdcBalance() < planTotal(batch.plan) + GAS_RESERVE) return { authorized: false, reason: "TREASURY_SHORT" };
    const claimed = must(await db().from("payment_batches").update({ authorizer_id: candidate.created_by, authorization_type: "STANDING", standing_authorization_id: candidate.id }).eq("id", batchId).eq("company_id", who.companyId).eq("status", "PROPOSED").is("authorizer_id", null).select("id"), "standing batch claim");
    if (!claimed.length) return { authorized: false, reason: "BATCH_ALREADY_CLAIMED" };
    if ((await standingFailures(input)).length) throw new WorkflowError("PLAN_INVALID", "standing authorization changed while claiming this plan; discard it and review again");
    await applyTransition(batches, batchMachine, { id: batchId, companyId: who.companyId, action: "authorize", actor: candidate.created_by, actorType: "system", correlationId, refs: { authorization: "STANDING", standingAuthorizationId: candidate.id, planHash: batch.plan_hash } });
    const opened = await openBatch({ ...who, userId: candidate.created_by, actorType: "system", correlationId }, batchId, owner);
    return { authorized: true, status: opened.status };
  }
  return { authorized: false, reason: "HUMAN_REVIEW_REQUIRED" };
}

/**
 * Plan signing (re-auth done by the route, S16). Re-checks everything against the database as it is now, authorizes the batch
 * (the trigger enforces four-eyes, the payment role and the kill switch), then opens the guard run on Arc. A batch that is already
 * AUTHORIZED only resumes opening, so a retry never signs twice.
 */
export async function signBatch(who: Who, batchId: string, port?: OwnerPort) {
  requirePaymentRole(who);
  const correlationId = who.correlationId ?? newCorrelationId();
  const batch = await loadBatch(who, batchId);
  if (batch.status === "AUTHORIZED" || batch.status === "OPEN") return openBatch(who, batchId, port); // a retry resumes; it never signs twice
  if (batch.status !== "PROPOSED") throw new TransitionError("INVALID_TRANSITION", `a ${batch.status} batch cannot be signed`);
  const run = await loadRun(who, batch.run_id);
  if (!PAYABLE_RUN.includes(run.status)) throw new TransitionError("INVALID_TRANSITION", `run is ${run.status}; plan again`);
  await assertLive(who.companyId);
  const approval = must(await db().from("payroll_approvals").select("approver_id").eq("company_id", who.companyId).eq("run_id", batch.run_id).single(), "approval read");
  assertFourEyes(approval.approver_id, who.userId);

  const rows = await eligible(who.companyId, batch.run_id);
  const failures = checkPlan(batch.plan, batch.plan_hash, rows);
  if (failures.length) throw new WorkflowError("PLAN_INVALID", `the plan no longer matches the obligations (${failures.join(", ")}); plan again`);
  const workers = must(await db().from("workers").select("id, wallet_address, wallet_confirmed_address").eq("company_id", who.companyId).in("id", rows.map((r) => r.worker_id)), "workers read");
  const confirmed = new Map(workers.map((w) => [w.id, w.wallet_address && w.wallet_address.toLowerCase() === w.wallet_confirmed_address?.toLowerCase() ? w.wallet_address.toLowerCase() : null]));
  const inPlan = new Set(batch.plan.obligations.map((o) => o.id));
  if (rows.some((r) => inPlan.has(r.id) && confirmed.get(r.worker_id) !== r.recipient.toLowerCase())) throw new WorkflowError("RECIPIENT_NOT_CONFIRMED", "a recipient changed since the plan was made; plan again");

  const limit = BigInt(must(await db().from("companies").select("per_payment_ceiling").eq("id", who.companyId).single(), "company read").per_payment_ceiling);
  if (batch.plan.obligations.some((o) => o.amount > limit)) throw new WorkflowError("PLAN_INVALID", "a payment in this plan is above the company's per-payment ceiling; the gate would refuse it. Raise the ceiling or plan again");
  const owner = port ?? (await ownerPort(who.companyId));
  const total = planTotal(batch.plan);
  if ((await owner.usdcBalance()) < total + GAS_RESERVE) throw new WorkflowError("TREASURY_SHORT", "the approver wallet does not hold enough USDC for this batch plus gas; top it up (amounts are never scaled)");

  // The signer is immutable once set, so a different user must not authorize a batch that carries someone else's name.
  const current = (await db().from("payment_batches").select("authorizer_id, authorization_type").eq("id", batchId).eq("company_id", who.companyId).single()).data;
  if (current?.authorization_type === "STANDING") throw new WorkflowError("CONFLICT", "standing authorization already claimed this plan; discard it and plan again if it cannot proceed");
  if (current?.authorizer_id && current.authorizer_id !== who.userId) throw new WorkflowError("CONFLICT", "another user already started signing this plan; discard it and plan again");
  if (!current?.authorizer_id) {
    const claimed = must(await db().from("payment_batches").update({ authorizer_id: who.userId }).eq("id", batchId).eq("company_id", who.companyId).eq("status", "PROPOSED").eq("authorization_type", "HUMAN").is("authorizer_id", null).select("id"), "batch authorizer");
    if (!claimed.length) throw new WorkflowError("CONFLICT", "another request claimed this plan; refresh before continuing");
  }
  await applyTransition(batches, batchMachine, { id: batchId, companyId: who.companyId, action: "authorize", actor: who.userId, actorType: "user", correlationId, refs: { authorization: "HUMAN", planHash: batch.plan_hash } });
  return openBatch({ ...who, correlationId }, batchId, owner);
}

/** After the batch is AUTHORIZED: link its obligations, authorize them and move the run. Every step skips what is already done, so a crash here is resumable. */
async function finishAuthorization(who: Who, correlationId: string, batch: Awaited<ReturnType<typeof loadBatch>>) {
  if (batch.plan.heldIds.length) {
    const held = must(await db().from("obligations").select("id, status").eq("company_id", who.companyId).in("id", batch.plan.heldIds), "held obligations read");
    for (const row of held) if (row.status === "CREATED") await obStep(who, correlationId, row.id, "hold");
  }
  const ids = batch.plan.obligations.map((o) => o.id);
  must(await db().from("obligations").update({ batch_id: batch.id }).eq("company_id", who.companyId).in("id", ids).in("status", ["CREATED", "ON_HOLD", "AUTHORIZED"]).select("id"), "obligation batch");
  const rows = must(await db().from("obligations").select("id, status").eq("company_id", who.companyId).in("id", ids), "obligations read");
  if (batch.authorization_type === "STANDING" && rows.some(r => r.status === "ON_HOLD")) throw new WorkflowError("PLAN_INVALID", "standing authorization cannot release a held payment");
  for (const r of rows) if (r.status === "CREATED" || r.status === "ON_HOLD") await obStep(who, correlationId, r.id, "authorize");
  const run = await loadRun(who, batch.run_id);
  if (PAYABLE_RUN.includes(run.status)) await runAction(runStore, run.mode, run.status, { id: run.id, companyId: who.companyId, action: run.status === "OBLIGATIONS_CREATED" ? "authorize_first_batch" : "authorize_batch", actor: who.userId, actorType: who.actorType ?? "user", correlationId, refs: { batchId: batch.id } });
}

/** Commits the batch's obligations on the guard (`openRun`). Safe to repeat: if the run is already open on Arc it only records it. */
export async function openBatch(who: Who, batchId: string, port?: OwnerPort) {
  requirePaymentRole(who);
  const correlationId = who.correlationId ?? newCorrelationId();
  const batch = await loadBatch(who, batchId);
  if (batch.status === "OPEN") return { batchId, status: "OPEN" as const };
  if (batch.status !== "AUTHORIZED") throw new TransitionError("INVALID_TRANSITION", `a ${batch.status} batch cannot be opened`);
  await assertLive(who.companyId);
  if (batch.authorization_type === "STANDING") {
    const failures = batch.standing_authorization_id && batch.authorizer_id ? await standingFailures({ companyId: who.companyId, runId: batch.run_id, standingId: batch.standing_authorization_id, authorizerId: batch.authorizer_id, plan: batch.plan, planHash: batch.plan_hash }) : ["STANDING_NOT_FOUND"];
    if (failures.length) throw new WorkflowError("PLAN_INVALID", "standing authorization is no longer valid; a new human-reviewed plan is required");
    who = { ...who, userId: batch.authorizer_id!, actorType: "system" };
  }
  await finishAuthorization(who, correlationId, batch);

  const keys = must(await db().from("obligations").select("id, onchain_key, amount, recipient").eq("company_id", who.companyId).in("id", batch.plan.obligations.map((o) => o.id)), "obligations read");
  const byId = new Map(keys.map((k) => [k.id, k]));
  const list = batch.plan.obligations.map((p) => {
    const k = byId.get(p.id);
    if (!k || BigInt(k.amount) !== p.amount || k.recipient.toLowerCase() !== p.recipient.toLowerCase()) throw new WorkflowError("PLAN_INVALID", "an obligation no longer matches the signed plan");
    return { onchainKey: k.onchain_key as string, recipient: p.recipient, amount: p.amount };
  });
  const owner = port ?? (await ownerPort(who.companyId));
  const runKey = owner.runKeyFor(batchId);
  const open = async () => {
    const e = await owner.guardEntry(list[0].onchainKey);
    return e.committed && e.runOpen && e.runKey.toLowerCase() === runKey.toLowerCase();
  };
  if (!(await open())) {
    await owner.openRun(batchId, list);
    if (!(await open())) throw new WorkflowError("PLAN_INVALID", "the guard run did not open as signed; check the chain before retrying");
  }
  must(await db().from("payment_batches").update({ guard_run_key: runKey }).eq("id", batchId).eq("company_id", who.companyId).select("id"), "batch run key");
  await applyTransition(batches, batchMachine, { id: batchId, companyId: who.companyId, action: "open", actor: who.userId, actorType: who.actorType ?? "user", correlationId, refs: { guardRunKey: runKey } });
  return { batchId, status: "OPEN" as const };
}
