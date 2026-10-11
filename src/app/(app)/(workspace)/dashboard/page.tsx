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
import { reviewerSummary } from "@/server/db/reviewer-summary";

export const metadata = { title: "Dashboard · Kleeno" };

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
  let period: Awaited<ReturnType<typeof periodView>> = null;
  let periodUnavailable = false;
  if (selected) {
    try { period = await periodView(client, actor, selected.id); }
    catch { periodUnavailable = true; }
  }
  const runTable = await initialTable(client, actor.companyId, actor.roles, "runs", null);
  const payroll = isPayrollRole(actor.roles);
  const payment = isPaymentRole(actor.roles);
  let reviewSummary: Awaited<ReturnType<typeof reviewerSummary>> | null = null;
  let reviewUnavailable = false;
  if (selected && (payroll || payment)) {
    try { reviewSummary = await reviewerSummary(client, actor, selected.id); }
    catch { reviewUnavailable = true; }
  }
  const todos: { reason: string; href: string }[] = [];
  if (selected && period) {
    if (reviewSummary?.canReview) {
      const review = reviewSummary.review;
      const reason = !reviewSummary.readiness.ready ? "Resolve review readiness blockers" : !review.signoff ? "Sign off the validated review" : !review.export ? "Download the reviewed CSV" : !review.acknowledgement ? "Record the manual handoff outcome" : review.acknowledgement.status !== "MANUAL_ACCEPTED" ? "Investigate the open handoff" : null;
      if (reason) todos.push({ reason, href: `/runs/${selected.id}#review-heading` });
    }
    if (reviewUnavailable) todos.push({ reason: "Reload review readiness evidence", href: `/runs/${selected.id}` });
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
      <PageHeader title="Dashboard" description={company.name} />

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Live payments</span>
        <StatusPill status={company.live_payments_enabled ? "ON" : "OFF"} />
        <span className="ml-2 text-muted-foreground">Guard</span>
        <span className="rounded-chip border bg-secondary px-2 py-0.5 font-mono text-xs break-all">{company.guard_address ?? "not deployed"}</span>
      </div>

      {setup.done < setup.total && <SetupChecklist items={setup.items} done={setup.done} total={setup.total} />}

      {selected && reviewSummary && <section className="mt-6 panel min-w-0" aria-labelledby="dashboard-review-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="dashboard-review-heading" className="text-lg">Review readiness</h2><p className={reviewSummary.readiness.ready ? "text-sm font-medium" : "text-sm font-medium text-signal"}>{reviewSummary.readiness.ready ? "Ready for review" : "Review blocked"}</p></div>
        <p className="mt-2 text-sm text-muted-foreground">{selected.period_start} to {selected.period_end} · {selected.mode === "SIMULATION" ? "Simulation" : "Live testnet"}</p>
        <p className="mt-2 text-sm">{reviewSummary.settings ? `${reviewSummary.readiness.received} of ${reviewSummary.readiness.expected} required inputs received.` : "Data required: expected inputs and company cutoff must be configured."}</p>
        {reviewSummary.readiness.cutoff && <p className="mt-2 break-words text-sm">Cutoff: <time dateTime={reviewSummary.readiness.cutoff.at}>{reviewSummary.readiness.cutoff.at}</time> · {reviewSummary.readiness.cutoff.timeZone}</p>}
        {reviewSummary.readiness.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-signal">{reviewSummary.readiness.blockers.map((blocker, i) => <li key={`${i}-${blocker}`}>{blocker}</li>)}</ul>}
        <div className="mt-4 border-t border-border pt-3 text-sm"><p className="font-medium">{!reviewSummary.review.signoff ? "Review not signed off" : !reviewSummary.review.export ? "Review signed off; CSV not generated" : !reviewSummary.review.acknowledgement ? "Reviewed CSV generated; recipient outcome not recorded" : reviewSummary.review.acknowledgement.status === "MANUAL_ACCEPTED" ? "Accepted manually — payment settlement is separate" : reviewSummary.review.acknowledgement.status === "MANUAL_REJECTED" ? "Rejected — handoff remains open" : "Unknown — handoff remains open"}</p><p className="mt-2 text-muted-foreground">Nothing is paid by review sign-off. Export, delivery evidence and payment settlement are separate records.</p>{!reviewSummary.canReview && <p className="mt-2 text-muted-foreground">HR or a payroll reviewer must sign off and record the handoff.</p>}<Link href={`/runs/${selected.id}#review-heading`} className="mt-2 inline-flex min-h-11 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open review and handoff</Link></div>
      </section>}
      {selected && reviewUnavailable && <section className="mt-6 panel"><h2 className="text-lg">Review readiness unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Review readiness could not be loaded. No readiness or handoff outcome can be inferred.</p><Link href={`/runs/${selected.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open this run to retry</Link></section>}

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
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="panel"><h2 className="text-lg">My to-dos</h2>{todos.length ? <ul className="mt-3 divide-y">{todos.map((todo) => <li key={todo.href + todo.reason} className="py-3"><Link href={todo.href} className="underline underline-offset-4">{todo.reason}</Link></li>)}</ul> : <p className="mt-4 text-muted-foreground">No action is waiting for your roles in this period.</p>}</section><section className="panel"><div className="flex items-center justify-between gap-3"><h2 className="text-lg">Recorded activity</h2><Link className="text-sm underline underline-offset-4" href={`/audit?run=${selected.id}`}>Full timeline</Link></div>{period.activity.unavailable ? <p role="alert" className="mt-3 text-sm text-signal">Activity unavailable. Recorded activity could not be loaded; no empty history can be inferred. Retry after checking database readiness.</p> : <AuditTimeline items={period.activity.items} />}{period.activity.graphTruncated && <p className="text-xs text-muted-foreground">Some older entity links exceed this view&apos;s limit. Open the company audit timeline for full history.</p>}</section></div>
      </> : periodUnavailable ? <section className="mt-6 panel"><h2 className="text-lg">Period details unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Period evidence could not be loaded. No counts, totals or payment readiness can be inferred. Retry after checking database readiness.</p></section> : <section className="mt-6 panel"><h2 className="text-lg">Your first payroll period</h2><p className="mt-2 text-muted-foreground">Approve a policy and start a run to see its progress and recorded metrics.</p><Link className="mt-3 inline-block underline underline-offset-4" href="/audit">View company audit history</Link></section>}

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
