import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { TableView } from "@/components/table-view";
import { AddWorkerForm, WorkerRow, type WorkerView } from "@/components/worker-forms";
import { formatUsdc } from "@/core/money";
import { isPayrollRole, isPaymentRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { initialTable } from "@/server/db/table-views";
import { listWorkers, type WorkerRow as Worker } from "@/server/db/workers";

export const metadata = { title: "Workers · Kleeno" };

const view = (w: Worker): WorkerView => ({
  id: w.id,
  pseudonym: w.pseudonym,
  payType: w.payType,
  base: w.compensation ? formatUsdc(w.compensation.baseAmount) : "—",
  hourly: w.compensation ? formatUsdc(w.compensation.hourlyRate) : "0",
  walletAddress: w.walletAddress,
  walletConfirmed: w.walletConfirmed,
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

function WorkerTable({ workers, canEdit, canConfirm }: { workers: WorkerView[]; canEdit: boolean; canConfirm: boolean }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        {head}
        {workers.map((w) => (
          <WorkerRow key={w.id} w={w} canEdit={canEdit} canConfirm={canConfirm} />
        ))}
      </table>
    </div>
  );
}

export default async function WorkersPage() {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const workers = (await listWorkers(client, actor.companyId)).map(view);
  const current = workers.filter((w) => w.active);
  const former = workers.filter((w) => !w.active);
  const canEdit = isPayrollRole(actor.roles);
  const canConfirm = isPaymentRole(actor.roles);
  const overview = await initialTable(client, actor.companyId, actor.roles, "workers", null);

  return (
    <>
      <PageHeader title="Workers" description="Everyone you pay. Workers appear by code (W001…), never by name: names stay on your computer. Pay amounts are encrypted at rest." />

      <section className="mt-6 panel">
        <h2 className="text-lg">Payees</h2>
        {current.length === 0 ? (
          <p className="mt-6 text-muted-foreground">No active workers. {canEdit ? "Add one below." : "The payroll approver adds workers."}</p>
        ) : (
          <WorkerTable workers={current} canEdit={canEdit} canConfirm={canConfirm} />
        )}
        <p className="mt-6 text-sm text-muted-foreground">Custodial wallets managed by the company. Arc testnet USDC, no real funds. A payout address set by hand is not paid until a payment approver other than the person who set it confirms it with their password.</p>
      </section>

      <section className="mt-6 panel">
        <h2 className="text-lg">Table view</h2>
        <p className="mt-2 text-sm text-muted-foreground">Everyone in one table: choose columns, filter, sort, see totals and export. Changes to pay are made in the list above.</p>
        <TableView {...overview} empty="No workers yet." />
      </section>

      {former.length > 0 && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Former workers</h2>
          <p className="mt-2 text-sm text-muted-foreground">Skipped in new runs. Past runs, payments and history are kept.</p>
          <WorkerTable workers={former} canEdit={canEdit} canConfirm={canConfirm} />
        </section>
      )}

      {canEdit && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Add a worker</h2>
          <AddWorkerForm />
        </section>
      )}
    </>
  );
}
