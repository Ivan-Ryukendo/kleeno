import { connection } from "next/server";
import { Lock, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AddWorkerPanel } from "@/components/add-worker-panel";
import { Notice } from "@/components/people-ui";
import { TableView } from "@/components/table-view";
import { WorkerDirectory, type DirectoryRow } from "@/components/worker-directory";
import { AddWorkerForm, type WorkerView } from "@/components/worker-forms";
import { formatUsdc } from "@/core/money";
import { isPayrollRole, isPaymentRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { initialTable } from "@/server/db/table-views";
import { listWorkers, type WorkerRow as Worker } from "@/server/db/workers";
import { ResourceColumnForm } from "@/components/resource-column-form";
import { WorkerHistoryPanel } from "@/components/worker-history";
import { workerHistoryView } from "@/server/db/views";
import { uuid } from "@/server/schemas";
import { newCorrelationId } from "@/core/audit";
import { logError } from "@/server/log";

export const metadata = { title: "All Workers · Kleeno" };

function Header({ count, actions }: { count?: number; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-2xl font-medium tracking-tight">All Workers</h1>
      {count !== undefined && <span className="inline-flex h-5.5 items-center rounded-chip border border-border px-1.5 text-[13px] text-muted-foreground tabular-nums" title="Workers in this company">{count}</span>}
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const headerButton = "inline-flex h-7.5 items-center gap-1.5 rounded-field border px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[520px]:min-h-11";

function unavailable(error: unknown) {
  const supportCode = newCorrelationId();
  logError("workers-page", supportCode, error);
  return <>
    <Header />
    <p className="mt-1 text-muted-foreground">Everyone you pay, by worker code. Names stay on your computer.</p>
    <section role="alert" className="mt-6 panel space-y-3">
      <h2 className="text-lg">Workers unavailable</h2>
      <p className="text-sm">Worker records and pay history could not be loaded. Reload this page. If the problem continues, share the support code with your administrator.</p>
      <p className="break-all text-xs text-muted-foreground">Support code: {supportCode}</p>
      <a href="/workers" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary">Reload Workers</a>
    </section>
  </>;
}

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
  metadata: w.metadata,
});

export default async function WorkersPage({ searchParams }: { searchParams: Promise<{ worker?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client, companies } = session;
  const selected = (await searchParams).worker;
  if (selected && !uuid.safeParse(selected).success) notFound();
  let history: Awaited<ReturnType<typeof workerHistoryView>> | null;
  try {
    history = selected ? await workerHistoryView(client, actor.companyId, selected, actor.roles) : null;
  } catch (error) { return unavailable(error); }
  if (selected && !history) notFound();
  const financial = isPayrollRole(actor.roles) || isPaymentRole(actor.roles);
  let workers: Worker[], overview: Awaited<ReturnType<typeof initialTable>>;
  try {
    workers = financial ? await listWorkers(client, actor.companyId) : [];
    overview = await initialTable(client, actor.companyId, actor.roles, "workers", null);
  } catch (error) { return unavailable(error); }
  const canEdit = isPayrollRole(actor.roles);
  const canConfirm = isPaymentRole(actor.roles);
  const contextKey = `${actor.companyId}:${actor.userId}`;
  const company = companies.find((c) => c.companyId === actor.companyId)?.name ?? "this company";
  const rows: DirectoryRow[] = financial
    ? workers.map((w) => ({
        id: w.id, code: w.pseudonym, payType: w.payType, active: w.active, leftOn: w.leftOn,
        type: w.metadata.workerType, jobTitle: w.metadata.jobTitle, department: w.metadata.department, startDate: w.metadata.employmentStart,
        wallet: w.walletAddress ? (w.walletConfirmed ? "VERIFIED" : "PENDING") : "NONE",
        ...(canEdit || canConfirm ? { view: view(w) } : {}),
      }))
    : overview.initial.rows.map((row, i) => ({ id: overview.initial.rowIds![i], code: String(row.code), payType: String(row.payType ?? ""), active: row.status !== "LEFT", leftOn: row.leftOn ? String(row.leftOn) : null, type: null, jobTitle: null, department: null, startDate: null, wallet: null }));
  const employees = workers.filter((w) => w.metadata.workerType === "EMPLOYEE").length;
  const contractors = workers.filter((w) => w.metadata.workerType === "CONTRACTOR").length;
  const unspecified = workers.length - employees - contractors;

  return (
    <>
      <Header
        count={rows.length}
        actions={canEdit && (
          <>
            <Link href="/import" className={`${headerButton} border-border bg-background hover:bg-accent`}><Upload aria-hidden="true" className="size-4" />Import</Link>
            <a href="#add-worker" className={`${headerButton} border-primary bg-primary text-primary-foreground hover:bg-primary/85`}><UserPlus aria-hidden="true" className="size-4" />Add worker</a>
          </>
        )}
      />
      <p className="mt-1 mb-5 text-muted-foreground">
        {financial ? <>Everyone {company} pays: {employees} {employees === 1 ? "employee" : "employees"} and {contractors} {contractors === 1 ? "contractor" : "contractors"}{unspecified > 0 ? `, ${unspecified} not specified` : ""}. </> : <>Everyone {company} pays. </>}
        Amounts for each period live in <Link href="/dashboard#pay-runs" className="underline underline-offset-4">Payroll</Link>; open a person for their history{financial ? " and changes" : ""}.
      </p>

      {!financial && <Notice icon={Lock} className="mb-3"><p>Your role cannot inspect pay amounts or wallet addresses. Use the worker directory below.</p></Notice>}

      {rows.length === 0 ? (
        <section className="panel text-center">
          <p className="text-muted-foreground">No active workers. {canEdit ? "Add one below." : "The payroll approver adds workers."}</p>
        </section>
      ) : (
        <WorkerDirectory rows={rows} detail={financial} canEdit={canEdit} canConfirm={canConfirm} contextKey={contextKey} company={company} />
      )}
      {financial && rows.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Custodial wallets managed by the company. Arc testnet USDC, no real funds. A payout address set by hand is not paid until a payment approver other than the person who set it confirms it with their password.</p>}

      <section className="mt-8 panel">
        <h2 className="text-lg">Table view</h2>
        <p className="mt-2 text-sm text-muted-foreground">Everyone in one table: choose columns, filter, sort, see totals and export. Pay changes are made from Manage on a worker above.</p>
        <TableView {...overview} empty="No workers yet." />
      </section>

      {canEdit && <section className="mt-6 panel"><h2 className="text-lg">Custom resource columns</h2><p className="mt-2 text-sm text-muted-foreground">Review source inputs and approved policy rules for leave, attendance and performance. These columns never edit calculated pay.</p><ResourceColumnForm key={contextKey} /></section>}
      {history && <WorkerHistoryPanel key={selected} history={history} />}

      {canEdit && (
        <AddWorkerPanel>
          <AddWorkerForm key={contextKey} />
        </AddWorkerPanel>
      )}
    </>
  );
}
