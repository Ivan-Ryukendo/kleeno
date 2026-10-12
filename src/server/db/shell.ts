import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECON_CATEGORIES } from "@/core/reconciliation";
import { isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";
import { logError } from "@/server/log";
import { must } from "./client";

// Read-only queries behind the app shell (P4u): the Ctrl+K search index, the bell's to-dos and the sidebar's open-exception count.
// Everything reads through the user-scoped client (RLS is the second wall, S11) and the session's company, never a request value.
// Worker codes only (W001...), never names, and no amounts: what a to-do or a search hit shows is what the role already sees.

export interface Todo {
  id: string;
  /** Plain-words reason. Contains no names and no amounts. */
  reason: string;
  href: string;
  /** "risk" is for things that can stop money (rule 45); everything else is a plain action. */
  tone: "action" | "risk";
}

export interface SearchRun {
  id: string;
  label: string;
  mode: string;
  status: string;
}

export interface SearchWorker {
  id: string;
  /** Worker code (W001...), never a name. */
  code: string;
}

export interface ShellData {
  todos: Todo[];
  openExceptions: number;
  runs: SearchRun[];
  workers: SearchWorker[];
}

export const EMPTY_SHELL: ShellData = { todos: [], openExceptions: 0, runs: [], workers: [] };

const OPEN_EXCEPTION = ["OPEN", "IN_REVIEW", "ESCALATED"];
const MAX_WORKER_CODES = 500;
const period = (r: { period_start: string; period_end: string }) => `${r.period_start} to ${r.period_end}`;
const same = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

interface RunRow {
  id: string;
  mode: string;
  status: string;
  period_start: string;
  period_end: string;
}

/** Everything the shell needs in one go. A failure here must never break the page behind it, so it degrades to "nothing to show". */
export async function shellData(client: SupabaseClient, actor: { companyId: string; userId: string; roles: readonly Role[] }): Promise<ShellData> {
  try {
    return await load(client, actor);
  } catch (e) {
    logError("shell", "data_failed", e);
    return EMPTY_SHELL;
  }
}

async function load(client: SupabaseClient, { companyId, userId, roles }: { companyId: string; userId: string; roles: readonly Role[] }): Promise<ShellData> {
  const payroll = isPayrollRole(roles);
  const payment = isPaymentRole(roles);
  const runCols = "id, mode, status, period_start, period_end";

  const [recent, workers, awaitingApproval, proposed, unconfirmed, openRows] = await Promise.all([
    client.from("payroll_runs").select(runCols).eq("company_id", companyId).order("created_at", { ascending: false }).limit(8),
    client.from("workers").select("id, pseudonym").eq("company_id", companyId).order("pseudonym").limit(MAX_WORKER_CODES),
    payroll ? client.from("payroll_runs").select(runCols).eq("company_id", companyId).eq("mode", "LIVE_TESTNET").eq("status", "PENDING_APPROVAL").order("created_at", { ascending: false }).limit(10) : null,
    payment ? client.from("payment_batches").select("id, run_id").eq("company_id", companyId).eq("status", "PROPOSED").limit(20) : null,
    payment ? client.from("workers").select("pseudonym, wallet_address, wallet_confirmed_address, wallet_set_by").eq("company_id", companyId).eq("active", true).not("wallet_address", "is", null).limit(MAX_WORKER_CODES) : null,
    payroll ? client.from("exceptions").select("run_id").eq("company_id", companyId).in("status", OPEN_EXCEPTION).in("category", RECON_CATEGORIES).limit(2000) : null,
  ]);

  const runs = must(recent, "shell runs") as RunRow[];
  const todos: Todo[] = [];

  // 1. A payroll run is waiting for me to approve it (payroll roles).
  if (awaitingApproval) {
    for (const r of must(awaitingApproval, "shell approvals") as RunRow[]) todos.push({ id: `approve-${r.id}`, reason: `Payroll for ${period(r)} is waiting for your approval`, href: `/runs/${r.id}`, tone: "action" });
  }

  // 2. A payment plan is waiting for my signature. The person who approved the payroll can never sign it (four-eyes), so those do not count as mine.
  if (proposed) {
    const batches = must(proposed, "shell batches") as { id: string; run_id: string }[];
    if (batches.length > 0) {
      const runIds = [...new Set(batches.map((b) => b.run_id))];
      const [approvals, planRuns] = await Promise.all([
        client.from("payroll_approvals").select("run_id, approver_id").eq("company_id", companyId).in("run_id", runIds),
        client.from("payroll_runs").select(runCols).eq("company_id", companyId).in("id", runIds),
      ]);
      const approver = new Map((must(approvals, "shell plan approvals") as { run_id: string; approver_id: string }[]).map((a) => [a.run_id, a.approver_id]));
      const label = new Map((must(planRuns, "shell plan runs") as RunRow[]).map((r) => [r.id, period(r)]));
      for (const runId of runIds) {
        if (approver.get(runId) === userId) continue;
        todos.push({ id: `sign-${runId}`, reason: `Payment plan for ${label.get(runId) ?? "a run"} is waiting for your signature`, href: `/settlement?run=${runId}`, tone: "action" });
      }
    }
  }

  // 3. A payout address was set by hand and a different payment approver has to confirm it.
  if (unconfirmed) {
    const pending = (must(unconfirmed, "shell recipients") as { pseudonym: string; wallet_address: string; wallet_confirmed_address: string | null; wallet_set_by: string | null }[]).filter((w) => !same(w.wallet_address, w.wallet_confirmed_address) && w.wallet_set_by !== userId);
    for (const w of pending.slice(0, 10)) todos.push({ id: `recipient-${w.pseudonym}`, reason: `${w.pseudonym}: a new payout address needs your confirmation`, href: "/workers", tone: "risk" });
  }

  // 4. Open exceptions, one line per run (the same count the sidebar shows).
  let openExceptions = 0;
  if (openRows) {
    const perRun = new Map<string, number>();
    for (const e of must(openRows, "shell exceptions") as { run_id: string }[]) perRun.set(e.run_id, (perRun.get(e.run_id) ?? 0) + 1);
    openExceptions = [...perRun.values()].reduce((a, b) => a + b, 0);
    if (perRun.size > 0) {
      const labels = new Map(((await client.from("payroll_runs").select(runCols).eq("company_id", companyId).in("id", [...perRun.keys()])).data ?? ([] as RunRow[])).map((r: RunRow) => [r.id, period(r)]));
      for (const [runId, n] of perRun) todos.push({ id: `exceptions-${runId}`, reason: `${n} open ${n === 1 ? "exception" : "exceptions"} in ${labels.get(runId) ?? "a run"}`, href: `/exceptions?run=${runId}`, tone: "risk" });
    }
  }

  return {
    todos,
    openExceptions,
    runs: runs.map((r) => ({ id: r.id, label: period(r), mode: r.mode, status: r.status })),
    workers: (must(workers, "shell workers") as { id: string; pseudonym: string }[]).map((w) => ({ id: w.id, code: w.pseudonym })),
  };
}
