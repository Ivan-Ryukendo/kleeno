import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsdc } from "@/core/money";
import { EXPLORER_TX } from "@/server/arc/reader";
import { must } from "./client";
import { loadLines } from "./calculations";

// Read models for pages. They read through the user-scoped client, so RLS is the second wall behind the company filter (S11).
const usd = (n: number | bigint) => formatUsdc(BigInt(n));

export async function dashboardView(client: SupabaseClient, companyId: string) {
  const company = must(await client.from("companies").select("name, live_payments_enabled, guard_address, mfa_required").eq("id", companyId).single(), "company");
  const runs = must(await client.from("payroll_runs").select("id, mode, status, config_version, period_start, period_end, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20), "runs");
  return { company, runs };
}

/** Null when the run is not in the caller's company (the page answers 404, S13). */
export async function runView(client: SupabaseClient, companyId: string, runId: string) {
  const { data: run } = await client.from("payroll_runs").select("*").eq("id", runId).eq("company_id", companyId).maybeSingle();
  if (!run) return null;
  const calc = (await client.from("calculations").select("id, calculation_hash").eq("run_id", runId).eq("company_id", companyId).maybeSingle()).data;
  const lines = calc ? await loadLines(client, companyId, calc.id) : [];
  const workers = must(await client.from("workers").select("id, pseudonym").eq("company_id", companyId), "workers");
  const obligations = must(await client.from("obligations").select("id, worker_id, amount, recipient, status, tx_hash, exception_code, exception_reasons").eq("run_id", runId).eq("company_id", companyId), "obligations");
  const name = (id: string) => workers.find((w) => w.id === id)?.pseudonym ?? "unknown";
  return {
    run,
    calculationHash: calc?.calculation_hash ?? null,
    lines: lines.map((l) => ({
      id: l.id,
      worker: name(l.workerId),
      gross: usd(l.gross),
      deductions: usd(l.deductions),
      net: usd(l.net),
      trace: l.trace.map((t) => ({ component: t.component, rule: t.rule, ruleVersion: t.ruleVersion, step: t.step, amount: usd(t.amount) })),
    })),
    obligations: obligations.map((o) => ({
      id: o.id,
      worker: name(o.worker_id),
      amount: usd(o.amount),
      recipient: o.recipient,
      status: o.status,
      txHash: o.tx_hash,
      txUrl: o.tx_hash ? EXPLORER_TX(o.tx_hash) : null,
      exception: o.exception_code ? { code: o.exception_code, reasons: o.exception_reasons ?? [] } : null,
    })),
  };
}
