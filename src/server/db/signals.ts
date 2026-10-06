import "server-only";
import { computeSignals, type PastPayment, type Signal } from "@/core/payments/signals";
import { db, must } from "./client";

/** Signals for a run's obligations, from the company's settled payment history (ARCHITECTURE 14.7). Reads only; stored with the plan in slice 2. */
export async function loadSignalEvidence(companyId: string, runId: string) {
  const run = must(await db().from("payroll_runs").select("id, config_version").eq("id", runId).eq("company_id", companyId).single(),"signal run read");
  const current = must(await db().from("obligations").select("id, worker_id, amount, recipient").eq("company_id", companyId).eq("run_id", runId), "obligations read");
  const past = must(
    await db().from("obligations").select("worker_id, amount, recipient, run_id").eq("company_id", companyId).eq("status", "SETTLED").neq("run_id", runId).in("worker_id", current.map((o) => o.worker_id)).order("updated_at", { ascending: false }),
    "history read",
  );
  const history = new Map<string, PastPayment[]>();
  for (const p of past) (history.get(p.worker_id) ?? history.set(p.worker_id, []).get(p.worker_id)!).push({ amount: BigInt(p.amount), recipient: p.recipient });
  // Previous company run is independent of which workers happen to be in this batch.
  const recent=must(await db().from("obligations").select("run_id").eq("company_id",companyId).eq("status","SETTLED").neq("run_id",runId).order("updated_at",{ascending:false}).limit(1),"previous settlement read");
  const previous = recent[0] ? must(await db().from("payroll_runs").select("config_version").eq("id", recent[0].run_id).eq("company_id", companyId).single(),"previous run read") : null;
  const signals=computeSignals({
    obligations: current.map((o) => ({ id: o.id, workerId: o.worker_id, amount: BigInt(o.amount), recipient: o.recipient })),
    history,
    configVersion: run.config_version,
    previousConfigVersion: previous?.config_version ?? null,
  });
  return { signals, configVersion: run.config_version as number, previousConfigVersion: (previous?.config_version ?? null) as number | null };
}

export async function loadSignals(companyId:string,runId:string):Promise<Signal[]>{return(await loadSignalEvidence(companyId,runId)).signals;}
