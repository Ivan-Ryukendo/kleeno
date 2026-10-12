import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsdc } from "@/core/money";
import { isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";
import { workerSummary } from "@/server/db/workers";

// Dashboard-only read helpers (R9.3). They read through the user-scoped client (RLS is the second wall) and return null
// whenever a figure is incomplete, so the page says "not available" instead of showing an estimate, a partial total or a zero.
// Money and worker figures are for payroll and payment roles only.

const CAP = 2000;
const financialRole = (roles: readonly Role[]) => isPayrollRole(roles) || isPaymentRole(roles);

export interface SettledRun { id: string; status: string; period_end: string }

/** Every SETTLED or RECONCILED run that ended in `year` (the selected run's calendar year). Null when the read fails or is partial. */
export async function settledRunsOfYear(client: SupabaseClient, companyId: string, year: number): Promise<SettledRun[] | null> {
  try {
    const read = await client.from("payroll_runs").select("id, status, period_end", { count: "exact" }).eq("company_id", companyId).in("status", ["SETTLED", "RECONCILED"]).gte("period_end", `${year}-01-01`).lte("period_end", `${year}-12-31`).limit(CAP + 1);
    const rows = read.data as SettledRun[] | null;
    return read.error || !rows || rows.length > CAP || read.count !== rows.length ? null : rows;
  } catch {
    return null;
  }
}

/** Sum of settled obligations of those runs. Null value means "not available" (partial read, error or a role without money access), never zero. */
export async function paidInYear(client: SupabaseClient, companyId: string, settledRuns: readonly SettledRun[] | null, year: number, roles: readonly Role[]) {
  const hiddenForRole = !financialRole(roles);
  if (settledRuns === null) return { year, value: null, payments: 0, runs: null, hiddenForRole };
  if (settledRuns.length === 0 || hiddenForRole) return { year, value: null, payments: 0, runs: settledRuns.length, hiddenForRole };
  try {
    const read = await client.from("obligations").select("amount", { count: "exact" }).eq("company_id", companyId).eq("status", "SETTLED").in("run_id", settledRuns.map((r) => r.id)).limit(CAP + 1);
    const rows = read.data as { amount: string | number }[] | null;
    if (read.error || !rows || rows.length > CAP || read.count !== rows.length) return { year, value: null, payments: 0, runs: settledRuns.length, hiddenForRole };
    return { year, value: formatUsdc(rows.reduce((sum, r) => sum + BigInt(r.amount), 0n)), payments: rows.length, runs: settledRuns.length, hiddenForRole };
  } catch {
    return { year, value: null, payments: 0, runs: settledRuns.length, hiddenForRole };
  }
}

export interface WorkerFacts { total: number | null; employees: number | null; contractors: number | null; unspecified: number | null; unconfirmedWallets: number | null }

/** Active workers. The employee/contractor split and wallet confirmation come from decrypted worker metadata, so payroll and payment roles only; other roles get the head count. */
export async function workerFacts(client: SupabaseClient, companyId: string, roles: readonly Role[]): Promise<WorkerFacts> {
  const none: WorkerFacts = { total: null, employees: null, contractors: null, unspecified: null, unconfirmedWallets: null };
  try {
    if (financialRole(roles)) return await workerSummary(client, companyId);
    const read = await client.from("worker_directory").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("active", true);
    return { ...none, total: read.error ? null : read.count };
  } catch {
    return none;
  }
}
