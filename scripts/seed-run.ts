// Seeds one synthetic LIVE_TESTNET run for the guarded payment, walking the real state machines: active config, worker
// (Circle wallet as recipient), run, calculation, payroll approval, obligation, four-eyes batch authorization and the
// on-chain openRun. Prints the obligation ID. Synthetic data only (rule 42).
// Needs: setup-wallets, deploy-guard, create-users, live-payments on, funded approver wallet.
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";
import { newCorrelationId } from "@/core/audit";
import type { ConfigParams } from "@/core/config";
import { batchMachine, obligationMachine, runMachine, type BatchState, type Machine, type ObligationState, type RunState } from "@/core/domain/machines";
import { applyTransition, type StateStore } from "@/core/domain/transition";
import { calculatePayroll, verifyCalculation } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { computePlanHash } from "@/core/payments/plan-hash";
import { createRun } from "@/core/workflow";
import { USDC_ADDRESS } from "@/server/arc/reader";
import { openRun } from "@/server/circle/guard-owner";
import { createWorkerWallet } from "@/server/circle/worker-wallet";
import { saveCalculation } from "@/server/db/calculations";
import { db, must } from "@/server/db/client";
import { configAction, createConfigDraft, loadConfig } from "@/server/db/configs";
import { runDeps, runStore } from "@/server/db/runs";
import { dbStore } from "@/server/db/store";
import { createWorker, setWorkerWallet } from "@/server/db/workers";
import { COMPANY_ID, company, fail, wallets } from "./_lib";

const AMOUNT = parseUsdc(process.env.SEED_AMOUNT_USDC ?? "5"); // demo LIVE run stays <= 100 USDC (ARCHITECTURE 14.1)
const PARAMS: ConfigParams = {
  scheduledHoursPerPeriod: "160",
  weeklyOvertimeThresholdHours: "40",
  overtimeMultiplier: "1.5",
  hourlyCapHours: null,
  aboveCapMultiplier: "1.0",
  deductions: [],
  varianceTolerance: "0.01",
  rules: [{ ruleId: "BASE_SALARY", clauseIds: ["C1"] }],
};

const correlationId = newCorrelationId();
async function step<S extends string>(store: StateStore<S>, m: Machine<S>, id: string, actions: string[]) {
  for (const action of actions) await applyTransition(store, m, { id, companyId: COMPANY_ID, action, actor: "seed-run", actorType: "script", correlationId });
}

async function ensureActiveConfig(payroll: string) {
  const active = (await db().from("payroll_configurations").select("version").eq("company_id", COMPANY_ID).eq("status", "ACTIVE").maybeSingle()).data;
  if (active) return (await loadConfig(COMPANY_ID, active.version))!.config;
  const who = { companyId: COMPANY_ID, userId: payroll, roles: ["PAYROLL_APPROVER" as const], correlationId };
  const draft = await createConfigDraft(who, { params: PARAMS, clauses: [{ id: "C1", text: "Salaried workers receive their base amount each period. (synthetic)" }] });
  for (const a of ["validate", "request_review", "approve", "activate"]) await configAction(who, draft.id, a);
  return (await loadConfig(COMPANY_ID, draft.version))!.config;
}

async function ensureWorker(payroll: string) {
  let w = (await db().from("workers").select("id, wallet_id, wallet_address").eq("company_id", COMPANY_ID).eq("pseudonym", "W001").maybeSingle()).data;
  if (!w) {
    const { id } = await createWorker({ companyId: COMPANY_ID, userId: payroll, correlationId }, { pseudonym: "W001", payType: "SALARIED", compensation: { baseAmount: AMOUNT, hourlyRate: 0n } });
    w = { id, wallet_id: null, wallet_address: null };
  }
  if (!w.wallet_id) {
    const c = await createWorkerWallet(COMPANY_ID, w.id);
    await setWorkerWallet(COMPANY_ID, w.id, { walletId: c.walletId, address: c.address, source: "CIRCLE" });
    w = { ...w, wallet_id: c.walletId, wallet_address: c.address };
  }
  return { id: w.id, address: w.wallet_address! };
}

async function main() {
  const co = await company();
  if (!co.live_payments_enabled) fail("live payments are OFF for this company; run live-payments.ts on");
  if (!co.guard_address) fail("deploy the guard first");
  const { approver } = await wallets();
  if (!approver) fail("run setup-wallets first");
  const users = must(await db().from("memberships").select("user_id, roles").eq("company_id", COMPANY_ID).is("removed_at", null), "users read");
  const payroll = users.find((u) => u.roles.includes("PAYROLL_APPROVER"))?.user_id;
  const payment = users.find((u) => u.roles.includes("PAYMENT_APPROVER"))?.user_id;
  if (!payroll || !payment) fail("run create-users first");

  const config = await ensureActiveConfig(payroll!);
  const worker = await ensureWorker(payroll!);
  const today = new Date().toISOString().slice(0, 10);
  const { id: runId } = await createRun(runDeps, { companyId: COMPANY_ID, userId: payroll!, roles: ["PAYROLL_APPROVER"], correlationId }, { mode: "LIVE_TESTNET", periodStart: today, periodEnd: today });

  await step<RunState>(runStore, runMachine, runId, ["import_data", "start_reconciliation", "finish_reconciliation", "calculate"]);
  const entries = [{ worker: { workerId: worker.id, payType: "SALARIED" as const, baseAmount: AMOUNT, hourlyRate: 0n }, input: { workedHours: "160" } }];
  const calc = calculatePayroll(config, entries);
  const problems = verifyCalculation(config, entries, calc);
  if (problems.length) fail(`calculation failed its checks: ${problems.join("; ")}`);
  const { calculationId, lineIds } = await saveCalculation(COMPANY_ID, runId, config, entries, calc);
  await step<RunState>(runStore, runMachine, runId, ["validate_calculation", "submit_for_approval"]);
  const approval = must(await db().from("payroll_approvals").insert({ company_id: COMPANY_ID, run_id: runId, calculation_id: calculationId, calculation_hash: calc.calculationHash, approver_id: payroll }).select("id").single(), "approval");
  await step<RunState>(runStore, runMachine, runId, ["approve"]);

  const line = calc.lines[0];
  const obId = randomUUID();
  const onchainKey = keccak256(toHex(obId));
  must(
    await db().from("obligations").insert({ id: obId, company_id: COMPANY_ID, run_id: runId, worker_id: worker.id, calculation_line_id: lineIds.get(worker.id)!, approval_id: approval.id, amount: Number(line.net), currency: "USDC", network: "ARC-TESTNET", recipient: worker.address, config_version: config.version, calculation_hash: calc.calculationHash, idempotency_key: randomUUID(), onchain_key: onchainKey }).select("id").single(),
    "obligation",
  );
  await step<RunState>(runStore, runMachine, runId, ["create_obligations"]);

  const plan = { obligations: [{ id: obId, amount: line.net, recipient: worker.address }], heldIds: [] as string[], source: "FALLBACK" };
  const batch = must(
    await db().from("payment_batches").insert({ company_id: COMPANY_ID, run_id: runId, plan_hash: computePlanHash(plan), plan: { ...plan, obligations: plan.obligations.map((o) => ({ ...o, amount: o.amount.toString() })) } }).select("id").single(),
    "batch",
  );
  must(await db().from("payment_batches").update({ authorizer_id: payment }).eq("id", batch.id).select("id"), "batch authorizer");
  must(await db().from("obligations").update({ batch_id: batch.id }).eq("id", obId).select("id"), "obligation batch");
  await step<BatchState>(dbStore("payment_batches"), batchMachine, batch.id, ["authorize"]); // four-eyes trigger checks the authorizer
  await step<ObligationState>(dbStore("obligations"), obligationMachine, obId, ["authorize"]);

  const { txHash } = await openRun({ approverWalletId: approver!.circle_wallet_id, guardAddress: co.guard_address!, usdcAddress: USDC_ADDRESS }, batch.id, [{ onchainKey, recipient: worker.address, amount: line.net }]);
  must(await db().from("payment_batches").update({ guard_run_key: keccak256(toHex(batch.id)) }).eq("id", batch.id).select("id"), "batch run key");
  await step<BatchState>(dbStore("payment_batches"), batchMachine, batch.id, ["open"]);
  await step<RunState>(runStore, runMachine, runId, ["authorize_first_batch"]);
  console.log(`run opened on Arc (tx ${txHash}). Obligation to pay: ${obId}`);
}

main().catch((e) => {
  console.error("seed-run failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
