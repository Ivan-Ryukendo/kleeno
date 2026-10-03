import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsdc } from "@/core/money";
import { EXPLORER_TX, usdcBalanceOf } from "@/server/arc/reader";
import { db, must } from "./client";

// Read model for /settlement. It reads through the user-scoped client (RLS is the second wall, S11); bigint amounts become strings here.
const usd = (n: number | bigint | string) => formatUsdc(BigInt(n));
const ACTIVE_RUN = ["OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"];

export interface SettlementObligation {
  id: string;
  worker: string;
  amount: string;
  recipient: string;
  status: string;
  held: boolean;
  signals: string[];
  txUrl: string | null;
  txHash: string | null;
  exception: string | null;
}

export interface SettlementBatch {
  id: string;
  status: string;
  planHash: string;
  source: string;
  total: string;
  count: number;
  held: number;
  authorizedBy: "you" | "another user" | null;
}

export async function settlementView(client: SupabaseClient, companyId: string, userId: string, runId?: string) {
  const company = must(await client.from("companies").select("name, live_status, live_payments_enabled, guard_address, per_payment_ceiling, is_demo, is_sandbox").eq("id", companyId).single(), "company");
  const wallets = must(await client.from("company_wallets").select("role, address").eq("company_id", companyId), "wallets");
  const approver = wallets.find((w) => w.role === "APPROVER")?.address ?? null;
  const balance = approver ? await usdcBalanceOf(approver).then((b) => usd(b), () => null) : null; // a flaky RPC must not hide the page

  const runs = must(await client.from("payroll_runs").select("id, status, period_start, period_end, created_at").eq("company_id", companyId).eq("mode", "LIVE_TESTNET").in("status", ["PENDING_APPROVAL", "APPROVED", ...ACTIVE_RUN]).order("created_at", { ascending: false }).limit(10), "runs");
  const chosen = runs.find((r) => r.id === runId) ?? runs.find((r) => !["SETTLED", "RECONCILED"].includes(r.status)) ?? runs[0] ?? null;
  if (!chosen) return { company: { ...company, per_payment_ceiling: usd(company.per_payment_ceiling) }, approver, balance, runs, run: null };

  const workers = must(await client.from("workers").select("id, pseudonym").eq("company_id", companyId), "workers");
  const name = (id: string) => workers.find((w) => w.id === id)?.pseudonym ?? "unknown";
  const rows = must(await client.from("obligations").select("id, worker_id, amount, recipient, status, tx_hash, exception_code").eq("company_id", companyId).eq("run_id", chosen.id).order("created_at"), "obligations");
  const batches = must(await client.from("payment_batches").select("id, status, plan_hash, plan, authorizer_id, created_at").eq("company_id", companyId).eq("run_id", chosen.id).neq("status", "DISCARDED").order("created_at", { ascending: false }), "batches");
  const latest = batches[0] ?? null;
  const signals: { code: string; obligationId: string | null }[] = latest?.plan?.signals ?? [];
  const approval = (await client.from("payroll_approvals").select("approver_id").eq("company_id", companyId).eq("run_id", chosen.id).maybeSingle()).data;

  const obligations: SettlementObligation[] = rows.map((o) => ({
    id: o.id,
    worker: name(o.worker_id),
    amount: usd(o.amount),
    recipient: o.recipient,
    status: o.status,
    held: o.status === "ON_HOLD",
    signals: signals.filter((s) => s.obligationId === o.id).map((s) => s.code),
    txHash: o.tx_hash,
    txUrl: o.tx_hash ? EXPLORER_TX(o.tx_hash) : null,
    exception: o.exception_code,
  }));
  const batch: SettlementBatch | null = latest
    ? {
        id: latest.id,
        status: latest.status,
        planHash: latest.plan_hash,
        source: latest.plan.source,
        total: usd((latest.plan.obligations as { amount: string }[]).reduce((s, o) => s + BigInt(o.amount), 0n)),
        count: latest.plan.obligations.length,
        held: latest.plan.heldIds.length,
        authorizedBy: latest.authorizer_id ? (latest.authorizer_id === userId ? "you" : "another user") : null,
      }
    : null;

  return {
    company: { ...company, per_payment_ceiling: usd(company.per_payment_ceiling) },
    approver,
    balance,
    runs,
    run: {
      id: chosen.id,
      status: chosen.status,
      period: `${chosen.period_start} to ${chosen.period_end}`,
      payrollApprovedByYou: approval?.approver_id === userId,
      total: usd(rows.reduce((sum, o) => sum + BigInt(o.amount), 0n)),
      obligations,
      batch,
      runSignals: signals.filter((s) => s.obligationId === null).map((s) => s.code),
    },
  };
}

/** Live-payment requests the platform admin has to decide, plus those already approved or provisioned (for the status column). */
export async function liveRequests() {
  return must(await db().from("companies").select("id, name, live_status, live_requested_at, live_decided_at, guard_address").neq("live_status", "NOT_REQUESTED").order("live_requested_at", { ascending: false }), "live requests");
}
