import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { NewRunForm } from "@/components/new-run-form";
import { SetupChecklist } from "@/components/setup-checklist";
import { StatusPill } from "@/components/status-pill";
import { PeriodStepper } from "@/components/period-stepper";
import { AuditTimeline } from "@/components/audit-timeline";
import { Button } from "@/components/ui/button";
import { TableView } from "@/components/table-view";
import { setupChecklist } from "@/core/setup";
import { isOwner, isPaymentRole } from "@/core/tenancy";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { getCompany, setupFacts } from "@/server/db/company";
import { dashboardView, periodSteps, periodView } from "@/server/db/views";
import { uuid } from "@/server/schemas";
import { initialTable } from "@/server/db/table-views";

export const metadata = { title: "Home · Kleeno" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const requested = (await searchParams).run;
  if (requested && !uuid.safeParse(requested).success) notFound();
  const [{ company, runs, selected }, profile, facts] = await Promise.all([dashboardView(client, actor.companyId, requested), getCompany(actor.companyId), setupFacts(actor.companyId)]);
  if (requested && !selected) notFound();
  if (!profile.onboardedAt && isOwner(actor.roles)) redirect("/onboarding"); // new companies start with the three-step wizard
  const setup = setupChecklist(facts);
  const period = selected ? await periodView(client, actor, selected.id) : null;
  const runTable = await initialTable(client, actor.companyId, actor.roles, "runs", null);
  const payroll = isPayrollRole(actor.roles);
  const payment = isPaymentRole(actor.roles);
  const todos: { reason: string; href: string }[] = [];
  if (selected && period) {
    if (payroll && selected.status === "DRAFT") todos.push({ reason: "Import source records for this period.", href: `/import?run=${selected.id}` });
    if (payroll && ["DATA_IMPORTED", "RECONCILING"].includes(selected.status)) todos.push({ reason: "Reconcile the imported records before calculating payroll.", href: `/runs/${selected.id}` });
    if (payroll && period.openExceptions > 0) todos.push({ reason: `${period.openExceptions} open exceptions need a human decision.`, href: `/exceptions?run=${selected.id}` });
    if (payroll && ["READY_FOR_CALCULATION", "CALCULATED"].includes(selected.status)) todos.push({ reason: "Calculate and validate this period's payroll.", href: `/runs/${selected.id}` });
    if (payroll && selected.status === "PENDING_APPROVAL") todos.push({ reason: "Review the calculation before approving payroll.", href: `/runs/${selected.id}` });
    if (payroll && selected.status === "CALCULATION_VALIDATED" && selected.mode === "LIVE_TESTNET") todos.push({ reason: "Submit the validated calculation for payroll approval.", href: `/runs/${selected.id}` });
    if (period.canSign) todos.push({ reason: "A payment plan needs your separate authorization.", href: `/settlement?run=${selected.id}` });
    if (payment && ["PAYMENT_FAILED", "PARTIALLY_SETTLED"].includes(selected.status)) todos.push({ reason: "Review outstanding payments and recorded exceptions.", href: `/settlement?run=${selected.id}` });
  }

  return (
    <>
      <PageHeader title="Home" description={company.name} />

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Live payments</span>
        <StatusPill status={company.live_payments_enabled ? "ON" : "OFF"} />
        <span className="ml-2 text-muted-foreground">Guard</span>
        <span className="rounded-chip border bg-secondary px-2 py-0.5 font-mono text-xs break-all">{company.guard_address ?? "not deployed"}</span>
      </div>

      {setup.done < setup.total && <SetupChecklist items={setup.items} done={setup.done} total={setup.total} />}

      {selected && period ? <>
        <section className="mt-6 panel">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg">This period</h2><p className="mt-1 text-muted-foreground">{selected.period_start} to {selected.period_end} · Policy v{selected.config_version}</p><div className="mt-2 flex gap-2"><StatusPill status={selected.mode} /><StatusPill status={selected.status} /></div></div>
            <form className="flex flex-wrap items-end gap-2" action="/dashboard"><label className="text-xs text-muted-foreground">Select run<select name="run" defaultValue={selected.id} className="mt-1 block h-10 max-w-full rounded-field border bg-background px-2 text-sm">{!runs.some((r) => r.id === selected.id) && <option value={selected.id}>{selected.period_start} to {selected.period_end}</option>}{runs.map((r) => <option key={r.id} value={r.id}>{r.period_start} to {r.period_end} · {r.mode === "SIMULATION" ? "Simulation" : "Live testnet"}</option>)}</select></label><Button type="submit" variant="outline">Show</Button></form>
          </div>
          <PeriodStepper steps={periodSteps(selected.status, selected.mode, period.openExceptions, company.live_payments_enabled)} runId={selected.id} canPayroll={payroll} canPay={payment} />
          {selected.mode === "SIMULATION" && <p className="mt-4 text-xs text-muted-foreground">Simulation ends with validated calculation and variance review. It creates no payment obligations.</p>}
        </section>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          { label: "Workers in run", value: period.workers ?? "Unavailable", detail: period.workers === null ? "No complete source records yet" : "Distinct worker records" },
          { label: "Matched automatically", value: period.autoMatched ? `${Math.round(period.autoMatched.count / period.autoMatched.total * 100)}%` : "Unavailable", detail: period.autoMatched ? `${period.autoMatched.count} of ${period.autoMatched.total} imported records` : "Import and reconcile source records" },
          { label: "Open exceptions", value: period.openExceptions, detail: "Human review required", risk: period.openExceptions > 0 },
          { label: "Calculated net (USDC)", value: period.netTotal ?? "Unavailable", detail: period.netTotal === null ? "Validated run evidence required" : `${period.settled ?? "Unavailable"} of ${period.obligations ?? "unavailable"} obligations settled` },
        ].map((tile) => <div key={tile.label} className="rounded-card border p-4"><dt className="text-xs text-muted-foreground">{tile.label}</dt><dd className={`mt-2 text-2xl tabular-nums ${tile.risk ? "text-signal" : ""}`}>{tile.value}</dd><p className="mt-2 text-xs text-muted-foreground">{tile.detail}</p></div>)}</dl>
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="panel"><h2 className="text-lg">My to-dos</h2>{todos.length ? <ul className="mt-3 divide-y">{todos.map((todo) => <li key={todo.href + todo.reason} className="py-3"><Link href={todo.href} className="underline underline-offset-4">{todo.reason}</Link></li>)}</ul> : <p className="mt-4 text-muted-foreground">No action is waiting for your roles in this period.</p>}</section><section className="panel"><div className="flex items-center justify-between gap-3"><h2 className="text-lg">Recorded activity</h2><Link className="text-sm underline underline-offset-4" href={`/audit?run=${selected.id}`}>Full timeline</Link></div><AuditTimeline items={period.activity.items} />{period.activity.graphTruncated && <p className="text-xs text-muted-foreground">Some older entity links exceed this view&apos;s limit. Open the company audit timeline for full history.</p>}</section></div>
      </> : <section className="mt-6 panel"><h2 className="text-lg">Your first payroll period</h2><p className="mt-2 text-muted-foreground">Approve a policy and start a run to see its progress and recorded metrics.</p><Link className="mt-3 inline-block underline underline-offset-4" href="/audit">View company audit history</Link></section>}

      {isPayrollRole(actor.roles) && (
        <section id="start-run" className="mt-6 panel scroll-mt-20">
          <h2 className="text-lg">Start a run</h2>
          <NewRunForm />
        </section>
      )}

      <section id="pay-runs" className="mt-6 panel scroll-mt-20">
        <h2 className="text-lg">Pay runs</h2>
        {runs.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No runs yet.</p>
        ) : (
          <><TableView {...runTable} /><p className="mt-3 text-xs text-muted-foreground">Choose a period above to see its progress, or open a run from its cell context.</p></>
        )}
      </section>
    </>
  );
}
