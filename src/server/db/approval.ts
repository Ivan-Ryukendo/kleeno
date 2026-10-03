import "server-only";
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";
import { newCorrelationId } from "@/core/audit";
import { TransitionError, type RunState } from "@/core/domain/machines";
import { planObligations } from "@/core/payments/obligations";
import type { RunMode } from "@/core/ports";
import { isPayrollRole, runAction, WorkflowError, type Role } from "@/core/workflow";
import { db, must } from "./client";
import { runStore } from "./runs";

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}

async function loadLiveRun(who: Who, runId: string) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "only the payroll side approves payroll");
  const run = (await db().from("payroll_runs").select("id, mode, status").eq("id", runId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!run) throw new TransitionError("NOT_FOUND", "run not found");
  return { ...run, mode: run.mode as RunMode, status: run.status as RunState, correlationId: who.correlationId ?? newCorrelationId() };
}

const act = (who: Who, run: Awaited<ReturnType<typeof loadLiveRun>>, action: string, refs: Record<string, string | number> = {}) =>
  runAction(runStore, run.mode, run.status, { id: run.id, companyId: who.companyId, action, actor: who.userId, actorType: "user", correlationId: run.correlationId, refs });

export const submitRun = async (who: Who, runId: string) => {
  const run = await loadLiveRun(who, runId);
  return act(who, run, "submit_for_approval");
};

export const rejectRun = async (who: Who, runId: string) => {
  const run = await loadLiveRun(who, runId);
  return act(who, run, "reject");
};

/**
 * Payroll approval binds the run's calculation hash (rule 15); the database checks the hash, the LIVE mode and the approver's role.
 * The caller has re-authenticated the user (S16). Safe to repeat after a crash: an existing approval is reused, obligations resume.
 */
export async function approveRun(who: Who, runId: string) {
  const run = await loadLiveRun(who, runId);
  if (run.status === "PENDING_APPROVAL") {
    const calc = (await db().from("calculations").select("id, calculation_hash").eq("company_id", who.companyId).eq("run_id", runId).maybeSingle()).data;
    if (!calc) throw new WorkflowError("CALCULATION_BLOCKED", "this run has no calculation to approve");
    const have = (await db().from("payroll_approvals").select("id, approver_id").eq("company_id", who.companyId).eq("run_id", runId).maybeSingle()).data;
    // The approval row is immutable and names the approver; only that person may finish it, or four-eyes would check the wrong user.
    if (have && have.approver_id !== who.userId) throw new WorkflowError("FOUR_EYES", "another user already started approving this run; they have to finish it, or reject the run and start again");
    if (!have) must(await db().from("payroll_approvals").insert({ company_id: who.companyId, run_id: runId, calculation_id: calc.id, calculation_hash: calc.calculation_hash, approver_id: who.userId }).select("id"), "approval insert");
    await act(who, run, "approve", { calculationHash: calc.calculation_hash });
  }
  return createObligations(who, runId);
}

/** APPROVED -> obligations -> OBLIGATIONS_CREATED. Idempotent: one obligation per calculation line (DB unique), so a retry fills the gap. */
export async function createObligations(who: Who, runId: string) {
  const run = await loadLiveRun(who, runId);
  if (run.mode !== "LIVE_TESTNET") throw new WorkflowError("SIMULATION_CANNOT_PAY", "only a LIVE_TESTNET run has obligations");
  if (run.status !== "APPROVED" && run.status !== "OBLIGATIONS_CREATED") throw new TransitionError("INVALID_TRANSITION", `obligations are created after approval, not in ${run.status}`);
  const approval = (await db().from("payroll_approvals").select("id, calculation_id, calculation_hash").eq("company_id", who.companyId).eq("run_id", runId).maybeSingle()).data;
  if (!approval) throw new WorkflowError("CALCULATION_BLOCKED", "this run has no payroll approval");
  const calc = must(await db().from("calculations").select("config_version").eq("id", approval.calculation_id).single(), "calculation read");

  const made = new Set(must(await db().from("obligations").select("calculation_line_id").eq("company_id", who.companyId).eq("run_id", runId), "obligations read").map((o) => o.calculation_line_id));
  const lines = must(await db().from("calculation_lines").select("id, worker_id, net").eq("company_id", who.companyId).eq("calculation_id", approval.calculation_id), "lines read").filter((l) => !made.has(l.id));
  const workers = must(await db().from("workers").select("id, pseudonym, wallet_address, wallet_confirmed_address").eq("company_id", who.companyId).in("id", lines.map((l) => l.worker_id)), "workers read");
  const byId = new Map(workers.map((w) => [w.id, w]));
  const plan = planObligations(lines.map((l) => ({ lineId: l.id, workerId: l.worker_id, pseudonym: byId.get(l.worker_id)?.pseudonym ?? "unknown worker", net: BigInt(l.net), wallet: byId.get(l.worker_id)?.wallet_address ?? null, confirmedWallet: byId.get(l.worker_id)?.wallet_confirmed_address ?? null })));
  if (plan.blocked.length) throw new WorkflowError("RECIPIENT_NOT_CONFIRMED", `fix the wallet or get it confirmed first: ${plan.blocked.map((b) => `${b.pseudonym} (${b.reason === "NO_WALLET" ? "no wallet" : "unconfirmed address"})`).join(", ")}`);

  const rows = plan.drafts.map((d) => {
    const id = randomUUID();
    return { id, company_id: who.companyId, run_id: runId, worker_id: d.workerId, calculation_line_id: d.lineId, approval_id: approval.id, amount: Number(d.amount), currency: "USDC", network: "ARC-TESTNET", recipient: d.recipient, config_version: calc.config_version, calculation_hash: approval.calculation_hash, idempotency_key: randomUUID(), onchain_key: keccak256(toHex(id)) };
  });
  if (rows.length) must(await db().from("obligations").upsert(rows, { onConflict: "calculation_line_id", ignoreDuplicates: true }).select("id"), "obligations insert");
  const count = made.size + rows.length;
  if (run.status === "APPROVED") await act(who, run, "create_obligations", { obligations: count });
  return { status: "OBLIGATIONS_CREATED" as const, obligations: count };
}
