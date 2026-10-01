import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { AddWorkerForm, WorkerRow, type WorkerView } from "@/components/worker-forms";
import { formatUsdc } from "@/core/money";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { listWorkers, type WorkerRow as Worker } from "@/server/db/workers";

export const metadata = { title: "Workers · Kleeno" };

const view = (w: Worker): WorkerView => ({
  id: w.id,
  pseudonym: w.pseudonym,
  payType: w.payType,
  base: w.compensation ? formatUsdc(w.compensation.baseAmount) : "—",
  hourly: w.compensation ? formatUsdc(w.compensation.hourlyRate) : "0",
  walletAddress: w.walletAddress,
  active: w.active,
  leftOn: w.leftOn,
  leftReason: w.leftReason,
  history: w.history.map((h) => ({ version: h.version, reason: h.reason, base: formatUsdc(h.baseAmount), hourly: formatUsdc(h.hourlyRate), at: h.at })),
});

const head = (
  <thead className="text-muted-foreground">
    <tr>
      <th className="py-2 pr-4 font-medium">Code</th>
      <th className="py-2 pr-4 font-medium">Pay type</th>
      <th className="py-2 pr-4 text-right font-medium">Per period</th>
      <th className="py-2 pr-4 text-right font-medium">Hourly rate</th>
      <th className="py-2 pr-4 font-medium">Wallet (Arc testnet)</th>
      <th className="py-2 text-right font-medium">Actions</th>
    </tr>
  </thead>
);

function WorkerTable({ workers, canEdit }: { workers: WorkerView[]; canEdit: boolean }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        {head}
        {workers.map((w) => (
          <WorkerRow key={w.id} w={w} canEdit={canEdit} />
        ))}
      </table>
    </div>
  );
}

export default async function WorkersPage() {
  await connection();
  const { actor, client } = await pageSession();
  const workers = (await listWorkers(client, actor.companyId)).map(view);
  const current = workers.filter((w) => w.active);
  const former = workers.filter((w) => !w.active);
  const canEdit = isPayrollRole(actor.role);

  return (
    <>
      <AppNav />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Workers
        </p>
        <h1 className="mt-4 text-5xl">Everyone you pay</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Workers appear by code (W001…), never by name: names stay on your computer. Pay amounts are encrypted at rest.</p>

        <section className="mt-10 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="text-2xl">Payees</h2>
          {current.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No active workers. {canEdit ? "Add one below." : "The payroll approver adds workers."}</p>
          ) : (
            <WorkerTable workers={current} canEdit={canEdit} />
          )}
          <p className="mt-6 text-sm text-muted-foreground">Custodial wallets managed by the company. Arc testnet USDC, no real funds. Changing where a worker is paid needs re-authentication and arrives with payments (P4).</p>
        </section>

        {former.length > 0 && (
          <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
            <h2 className="text-2xl">Former workers</h2>
            <p className="mt-2 text-sm text-muted-foreground">Skipped in new runs. Past runs, payments and history are kept.</p>
            <WorkerTable workers={former} canEdit={canEdit} />
          </section>
        )}

        {canEdit && (
          <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
            <h2 className="text-2xl">Add a worker</h2>
            <AddWorkerForm />
          </section>
        )}
      </main>
    </>
  );
}
