// Seeds one synthetic LIVE_TESTNET run for the P1 payment: worker (Circle wallet as recipient), calculation,
// payroll approval, one obligation, an authorized batch, and the on-chain openRun. Prints the obligation ID.
// Synthetic data only (rule 42). Needs: setup-wallets, deploy-guard, create-users, live-payments on, funded approver.
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";
import { calculatePayroll } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { computePlanHash } from "@/core/payments/plan-hash";
import { circle, deterministicUuid } from "@/server/circle/client";
import { openRun } from "@/server/circle/guard-owner";
import { USDC_ADDRESS } from "@/server/arc/reader";
import { db, must } from "@/server/db/client";
import { COMPANY_ID, company, fail, wallets } from "./_lib";

const AMOUNT = parseUsdc(process.env.SEED_AMOUNT_USDC ?? "5"); // demo LIVE run stays <= 100 USDC (ARCHITECTURE 14.1)

async function workerWallet() {
  const existing = (await db().from("workers").select("*").eq("company_id", COMPANY_ID).eq("pseudonym", "worker-1").maybeSingle()).data;
  if (existing) return existing;
  const set = await circle().wallets.createWalletSet({ name: `kleeno-workers-${COMPANY_ID.slice(-4)}`, idempotencyKey: deterministicUuid(`workerset:${COMPANY_ID}`) });
  const walletSetId = set.data?.walletSet?.id;
  if (!walletSetId) throw new Error("no worker wallet set");
  const w = (await circle().wallets.createWallets({ blockchains: ["ARC-TESTNET"], count: 1, walletSetId, accountType: "EOA", idempotencyKey: deterministicUuid(`worker-wallet:${COMPANY_ID}:worker-1`) })).data?.wallets?.[0];
  if (!w) throw new Error("no worker wallet");
  return must(
    await db().from("workers").insert({ company_id: COMPANY_ID, pseudonym: "worker-1", pay_type: "SALARIED", base_amount: Number(AMOUNT), wallet_address: w.address, wallet_id: w.id }).select("*").single(),
    "worker insert",
  );
}

async function main() {
  const co = await company();
  if (!co.live_payments_enabled) fail("live payments are OFF for this company; run live-payments.ts on");
  if (!co.guard_address) fail("deploy the guard first");
  const { approver } = await wallets();
  if (!approver) fail("run setup-wallets first");
  const users = must(await db().from("app_users").select("id, role").eq("company_id", COMPANY_ID), "users read");
  const payroll = users.find((u) => u.role === "PAYROLL_APPROVER")?.id;
  const payment = users.find((u) => u.role === "PAYMENT_APPROVER")?.id;
  if (!payroll || !payment) fail("run create-users first");

  const worker = await workerWallet();
  const calc = calculatePayroll(1, [{ workerId: worker.id, payType: "SALARIED", baseAmount: AMOUNT }]);
  const line = calc.lines[0];

  const run = must(await db().from("payroll_runs").insert({ company_id: COMPANY_ID, mode: "LIVE_TESTNET", status: "APPROVED", config_version: 1, payroll_approver_id: payroll }).select("id").single(), "run");
  const c = must(await db().from("calculations").insert({ company_id: COMPANY_ID, run_id: run.id, config_version: 1, calculation_hash: calc.calculationHash }).select("id").single(), "calculation");
  const l = must(
    await db().from("calculation_lines").insert({ company_id: COMPANY_ID, calculation_id: c.id, worker_id: worker.id, gross: Number(line.gross), deductions: Number(line.deductions), net: Number(line.net), trace: JSON.parse(JSON.stringify(line.trace, (_, v) => (typeof v === "bigint" ? v.toString() : v))) }).select("id").single(),
    "line",
  );
  const appr = must(await db().from("payroll_approvals").insert({ company_id: COMPANY_ID, run_id: run.id, calculation_id: c.id, calculation_hash: calc.calculationHash, approver_id: payroll }).select("id").single(), "approval");

  const obId = randomUUID();
  const onchainKey = keccak256(toHex(obId));
  const plan = { obligations: [{ id: obId, amount: line.net, recipient: worker.wallet_address }], heldIds: [] as string[], source: "FALLBACK" };
  const planHash = computePlanHash(plan);
  must(
    await db().from("obligations").insert({ id: obId, company_id: COMPANY_ID, run_id: run.id, worker_id: worker.id, calculation_line_id: l.id, approval_id: appr.id, amount: Number(line.net), currency: "USDC", network: "ARC-TESTNET", recipient: worker.wallet_address, config_version: 1, calculation_hash: calc.calculationHash, idempotency_key: randomUUID(), onchain_key: onchainKey }).select("id").single(),
    "obligation",
  );
  const batch = must(
    await db().from("payment_batches").insert({ company_id: COMPANY_ID, run_id: run.id, status: "AUTHORIZED", authorizer_id: payment, plan_hash: planHash, plan: { ...plan, obligations: plan.obligations.map((o) => ({ ...o, amount: o.amount.toString() })) } }).select("id").single(),
    "batch",
  );
  must(await db().from("obligations").update({ batch_id: batch.id, status: "AUTHORIZED" }).eq("id", obId).select("id"), "authorize");

  const { txHash } = await openRun({ approverWalletId: approver.circle_wallet_id, guardAddress: co.guard_address, usdcAddress: USDC_ADDRESS }, batch.id, [{ onchainKey, recipient: worker.wallet_address, amount: line.net }]);
  must(await db().from("payment_batches").update({ status: "OPEN", guard_run_key: keccak256(toHex(batch.id)) }).eq("id", batch.id).select("id"), "batch open");
  console.log(`run opened on Arc (tx ${txHash}). Obligation to pay: ${obId}`);
}

main().catch((e) => {
  console.error("seed-run failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
