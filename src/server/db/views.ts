import "server-only";
import { formatUsdc } from "@/core/money";
import { EXPLORER_TX } from "@/server/arc/reader";
import { db, must } from "./client";

// P1 read models for the crude pages. localhost only: the pages 404 in production (no auth before P2, rule 41).
// P2 replaces DEV_COMPANY_ID with the company from the session.
export const DEV_COMPANY_ID = "00000000-0000-4000-8000-000000000002";

export async function dashboardView() {
  const company = must(await db().from("companies").select("name, live_payments_enabled, guard_address").eq("id", DEV_COMPANY_ID).single(), "company");
  const runs = must(await db().from("payroll_runs").select("id, mode, status, config_version, created_at").eq("company_id", DEV_COMPANY_ID).order("created_at", { ascending: false }).limit(20), "runs");
  return { company, runs };
}

export async function runView(runId: string) {
  const { data: run } = await db().from("payroll_runs").select("*").eq("id", runId).eq("company_id", DEV_COMPANY_ID).maybeSingle();
  if (!run) return null;
  const calc = (await db().from("calculations").select("id, calculation_hash").eq("run_id", runId).maybeSingle()).data;
  const lines = calc ? must(await db().from("calculation_lines").select("id, worker_id, gross, deductions, net, trace").eq("calculation_id", calc.id), "lines") : [];
  const workers = must(await db().from("workers").select("id, pseudonym").eq("company_id", DEV_COMPANY_ID), "workers");
  const obligations = must(await db().from("obligations").select("id, worker_id, calculation_line_id, amount, recipient, status, tx_hash, exception_code, exception_reasons").eq("run_id", runId), "obligations");
  const name = (id: string) => workers.find((w) => w.id === id)?.pseudonym ?? "unknown";
  const usd = (n: number) => formatUsdc(BigInt(n));
  return {
    run,
    calculationHash: calc?.calculation_hash ?? null,
    lines: lines.map((l) => ({
      id: l.id,
      worker: name(l.worker_id),
      gross: usd(l.gross),
      deductions: usd(l.deductions),
      net: usd(l.net),
      trace: (l.trace as { component: string; rule: string; ruleVersion: number; step: number; amount: string }[]).map((t) => ({ ...t, amount: usd(Number(t.amount)) })),
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
