import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsdc } from "@/core/money";
import { isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";
import type { RunLite } from "@/lib/dashboard-model";
import { listWorkers } from "@/server/db/workers";

// Dashboard-only read helpers (R9.3). They read through the user-scoped client (RLS is the second wall) and return null
// whenever a figure is incomplete, so the page says "not available" instead of showing an estimate or a zero.

const CAP = 2000;
const SETTLED = ["SETTLED", "RECONCILED"];

/** Sum of settled obligations in runs that ended in `year`. Financial roles only; null when the read is partial. */
export async function paidYearToDate(client: SupabaseClient, companyId: string, runs: readonly (RunLite & { id: string })[], year: number, roles: readonly Role[]) {
  const settledRuns = runs.filter((r) => SETTLED.includes(r.status) && r.period_end.startsWith(`${year}-`));
  const hiddenForRole = !(isPayrollRole(roles) || isPaymentRole(roles));
  if (settledRuns.length === 0) return { year, value: null, payments: 0, runs: 0, capped: runs.length >= 20, hiddenForRole };
  if (hiddenForRole) return { year, value: null, payments: 0, runs: settledRuns.length, capped: false, hiddenForRole };
  const read = await client.from("obligations").select("amount", { count: "exact" }).eq("company_id", companyId).eq("status", "SETTLED").in("run_id", settledRuns.map((r) => r.id)).limit(CAP + 1);
  const rows = read.data as { amount: string | number }[] | null;
  if (read.error || !rows || rows.length > CAP || read.count !== rows.length) return { year, value: null, payments: 0, runs: settledRuns.length, capped: false, hiddenForRole };
  return { year, value: formatUsdc(rows.reduce((sum, r) => sum + BigInt(r.amount), 0n)), payments: rows.length, runs: settledRuns.length, capped: runs.length >= 20, hiddenForRole };
}

export interface WorkerFacts { total: number | null; employees: number | null; contractors: number | null; unspecified: number | null; unconfirmedWallets: number | null }

/** Active workers; the employee/contractor split and wallet confirmation need the decrypted records, so payroll and payment roles only. */
export async function workerFacts(client: SupabaseClient, companyId: string, roles: readonly Role[]): Promise<WorkerFacts> {
  const none: WorkerFacts = { total: null, employees: null, contractors: null, unspecified: null, unconfirmedWallets: null };
  try {
    if (isPayrollRole(roles) || isPaymentRole(roles)) {
      const active = await listWorkers(client, companyId, { activeOnly: true });
      const count = (type: string | null) => active.filter((w) => w.metadata.workerType === type).length;
      return { total: active.length, employees: count("EMPLOYEE"), contractors: count("CONTRACTOR"), unspecified: count(null), unconfirmedWallets: active.filter((w) => w.walletAddress && !w.walletConfirmed).length };
    }
    const read = await client.from("worker_directory").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("active", true);
    return { ...none, total: read.error ? null : read.count };
  } catch {
    return none;
  }
}
