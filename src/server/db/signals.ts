import "server-only";
import { computeSignals, type PastPayment, type Signal } from "@/core/payments/signals";
import { db, must } from "./client";

/** Signals for a run's obligations, from the company's settled payment history (ARCHITECTURE 14.7). Reads only; stored with the plan in slice 2. */
export async function loadSignals(companyId: string, runId: string): Promise<Signal[]> {
  const run = (await db().from("payroll_runs").select("id, config_version").eq("id", runId).eq("company_id", companyId).single()).data;
  if (!run) return [];
  const current = must(await db().from("obligations").select("id, worker_id, amount, recipient").eq("company_id", companyId).eq("run_id", runId), "obligations read");
  const past = must(
    await db().from("obligations").select("worker_id, amount, recipient, run_id").eq("company_id", companyId).eq("status", "SETTLED").neq("run_id", runId).in("worker_id", current.map((o) => o.worker_id)).order("updated_at", { ascending: false }),
    "history read",
  );
  const history = new Map<string, PastPayment[]>();
  for (const p of past) (history.get(p.worker_id) ?? history.set(p.worker_id, []).get(p.worker_id)!).push({ amount: BigInt(p.amount), recipient: p.recipient });
  // The previous run is the company's most recent other run that has settled obligations.
  const previous = past[0] ? (await db().from("payroll_runs").select("config_version").eq("id", past[0].run_id).eq("company_id", companyId).single()).data : null;
  return computeSignals({
    obligations: current.map((o) => ({ id: o.id, workerId: o.worker_id, amount: BigInt(o.amount), recipient: o.recipient })),
    history,
    configVersion: run.config_version,
    previousConfigVersion: previous?.config_version ?? null,
  });
}
