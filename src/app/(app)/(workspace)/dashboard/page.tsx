import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, CalendarDays } from "lucide-react";
import { NewRunForm } from "@/components/new-run-form";
import { SetupChecklist } from "@/components/setup-checklist";
import { TableView } from "@/components/table-view";
import { Button } from "@/components/ui/button";
import { ReadinessPanel, type BlockerCard } from "@/components/dashboard/readiness-panel";
import { StatTiles } from "@/components/dashboard/stat-tiles";
import { ActivityPanel, TodoPanel, type Todo } from "@/components/dashboard/todo-activity";
import { LinkButton, Panel } from "@/components/dashboard/ui";
import { LocalTime } from "@/components/local-time";
import { describeFacts } from "@/core/reconciliation";
import { setupChecklist } from "@/core/setup";
import { isOwner, isPaymentRole, ROLE_LABELS } from "@/core/tenancy";
import { isPayrollRole } from "@/core/workflow";
import { daysLeftText, daysUntil, monthName, monthStrip, payDateFor, readinessSteps } from "@/lib/dashboard-model";
import { pageSession } from "@/server/auth/page-session";
import { getCompany, setupFacts } from "@/server/db/company";
import { listExceptions } from "@/server/db/reconciliation";
import { reviewerSummary } from "@/server/db/reviewer-summary";
import { initialTable } from "@/server/db/table-views";
import { dashboardView, periodView } from "@/server/db/views";
import { viewerTimeZone } from "@/server/display-timezone";
import { uuid } from "@/server/schemas";
import { paidYearToDate, workerFacts } from "./dashboard-data";

export const metadata = { title: "Dashboard · Kleeno" };

const OPEN = ["OPEN", "IN_REVIEW", "ESCALATED"];
const EXCEPTION_BLOCKER = "Resolve open exceptions before review sign-off";
const CARD_LIMIT = 4;
const CATEGORY: Record<string, string> = { DUPLICATE_TIMESHEET: "Duplicate timesheet lines", LEAVE_WORK_CONFLICT: "Leave and work on the same day", UNAPPROVED_OVERTIME: "Hours above the limit without approval", UNEXPLAINED_MISSING_HOURS: "Unexplained missing hours" };
const modeLabel = (mode: string) => (mode === "SIMULATION" ? "Simulation" : "Live testnet");

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
  const financial = payroll || payment;
  let reviewSummary: Awaited<ReturnType<typeof reviewerSummary>> | null = null;
  let reviewUnavailable = false;
  if (selected && financial) {
    try { reviewSummary = await reviewerSummary(client, actor, selected.id); }
    catch { reviewUnavailable = true; }
  }
  const timeZone = selected && financial ? await viewerTimeZone(actor, profile.profile.timezone) : "UTC"; // display only
  const now = new Date();
  const cutoff = reviewSummary?.readiness.cutoff ?? null;
  const roleText = actor.roles.map((r) => ROLE_LABELS[r]).join(" · ");

  const todos: Todo[] = [];
  if (selected && period) {
    const add = (reason: string, href: string, beforeCutoff = false) => todos.push({ reason, href, beforeCutoff });
    if (reviewSummary?.canReview) {
      const review = reviewSummary.review;
      const reason = !reviewSummary.readiness.ready ? "Resolve review readiness blockers" : !review.signoff ? "Sign off the validated review" : !review.export ? "Download the reviewed CSV" : !review.acknowledgement ? "Record the manual handoff outcome" : review.acknowledgement.status !== "MANUAL_ACCEPTED" ? "Investigate the open handoff" : null;
      if (reason) add(reason, `/runs/${selected.id}#review-heading`, !review.signoff);
    }
    if (reviewUnavailable) add("Reload review readiness evidence", `/runs/${selected.id}`);
    if (payroll && selected.status === "DRAFT") add("Import source records for this period.", `/import?run=${selected.id}`, true);
    if (payroll && ["DATA_IMPORTED", "RECONCILING"].includes(selected.status)) add("Reconcile the imported records before calculating payroll.", `/runs/${selected.id}`, true);
    if (payroll && period.openExceptions > 0) add(`${period.openExceptions} open exceptions need a human decision.`, `/exceptions?run=${selected.id}`, true);
    if (payroll && ["READY_FOR_CALCULATION", "CALCULATED"].includes(selected.status)) add("Calculate and validate this period's payroll.", `/runs/${selected.id}`, true);
    if (payroll && selected.status === "PENDING_APPROVAL") add("Review the calculation before approving payroll.", `/runs/${selected.id}`, true);
    if (payroll && selected.status === "CALCULATION_VALIDATED" && selected.mode === "LIVE_TESTNET") add("Submit the validated calculation for payroll approval.", `/runs/${selected.id}`, true);
    if (period.canSign) add("A payment plan needs your separate authorization.", `/settlement?run=${selected.id}`);
    if (payment && ["PAYMENT_FAILED", "PARTIALLY_SETTLED"].includes(selected.status)) add("Review outstanding payments and recorded exceptions.", `/settlement?run=${selected.id}`);
  }

  // Panels that need extra reads: only for a loaded period, and a failed read degrades to "not available".
  let exceptionCards: BlockerCard[] | null = null;
  if (selected && period && financial && period.openExceptions > 0) {
    try {
      const open = (await listExceptions(client, actor.companyId, selected.id)).filter((e) => OPEN.includes(e.status));
      exceptionCards = open.slice(0, CARD_LIMIT).map((e) => ({ key: e.id, code: e.worker, tag: "Needs review", tone: "risk", text: `${CATEGORY[e.category] ?? e.category}: ${describeFacts(e.category, e.facts)}`, href: `/exceptions?run=${selected.id}`, action: "Review" }));
    } catch { exceptionCards = null; }
  }
  const [tiles, paid, workers] = selected && period
    ? await Promise.all([Promise.resolve(monthStrip(runs, Number(selected.period_end.slice(0, 4)), selected.period_end)), paidYearToDate(client, actor.companyId, runs, Number(selected.period_end.slice(0, 4)), actor.roles).catch(() => null), workerFacts(client, actor.companyId, actor.roles)])
    : [null, null, null];

  // Blockers: every readiness blocker, with the open exceptions expanded to one card per worker when they could be read.
  const blockers: BlockerCard[] = [];
  let blockerCount: number | null = null;
  let moreBlockers = 0;
  if (selected && period && reviewSummary) {
    const readinessBlockers = reviewSummary.readiness.blockers;
    for (const [i, text] of readinessBlockers.entries()) {
      if (text === EXCEPTION_BLOCKER && exceptionCards) continue;
      blockers.push({ key: `${i}-${text}`, code: null, tag: text === EXCEPTION_BLOCKER ? "Open exceptions" : "Needs attention", tone: text === EXCEPTION_BLOCKER ? "risk" : "plain", text, href: text === EXCEPTION_BLOCKER ? `/exceptions?run=${selected.id}` : `/runs/${selected.id}#review-heading`, action: text === EXCEPTION_BLOCKER ? "Review" : "Open review" });
    }
    if (exceptionCards) { blockers.unshift(...exceptionCards); moreBlockers = Math.max(0, period.openExceptions - exceptionCards.length); }
    const others = readinessBlockers.filter((b) => b !== EXCEPTION_BLOCKER).length;
    blockerCount = others + (exceptionCards ? period.openExceptions : readinessBlockers.includes(EXCEPTION_BLOCKER) ? 1 : 0);
  }
  const review = reviewSummary?.review;
  const handoff = reviewSummary && review && selected ? (
    <div className="mt-4 border-t pt-3 text-sm">
      <h3 className="text-xs font-medium text-muted-foreground">Review readiness and handoff</h3>
      <p className="mt-1.5">{reviewSummary.settings ? `${reviewSummary.readiness.received} of ${reviewSummary.readiness.expected} required inputs received.` : "Data required: expected inputs and company cutoff must be configured."}</p>
      <p className="mt-1.5 font-medium">{!review.signoff ? "Review not signed off" : !review.export ? "Review signed off; CSV not generated" : !review.acknowledgement ? "Reviewed CSV generated; recipient outcome not recorded" : review.acknowledgement.status === "MANUAL_ACCEPTED" ? "Accepted manually — payment settlement is separate" : review.acknowledgement.status === "MANUAL_REJECTED" ? "Rejected — handoff remains open" : "Unknown — handoff remains open"}</p>
      <p className="mt-1.5 text-muted-foreground">Nothing is paid by review sign-off. Export, delivery evidence and payment settlement are separate records.</p>
      {!reviewSummary.canReview && <p className="mt-1.5 text-muted-foreground">HR or a payroll reviewer must sign off and record the handoff.</p>}
      <Link href={`/runs/${selected.id}#review-heading`} className="mt-1.5 inline-flex min-h-11 items-center rounded-field underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8">Open review and handoff</Link>
    </div>
  ) : null;

  const runLabel = selected ? `${selected.period_start} to ${selected.period_end}` : "";
  const cutoffText = cutoff ? <LocalTime at={cutoff.at} timeZone={timeZone} /> : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-medium tracking-tight max-sm:basis-full">Dashboard</h1>
        {selected && (
          <form action="/dashboard" className="flex items-center gap-2">
            <label className="flex min-w-0 items-center gap-1.5 rounded-field border bg-background px-2.5 text-[0.8125rem]">
              <CalendarDays aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="sr-only">Select run</span>
              <select name="run" defaultValue={selected.id} className="h-10 min-w-0 max-w-[16rem] bg-transparent py-0 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7">
                {!runs.some((r) => r.id === selected.id) && <option value={selected.id}>{runLabel}</option>}
                {runs.map((r) => <option key={r.id} value={r.id}>{r.period_start} to {r.period_end} · {modeLabel(r.mode)}</option>)}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-10 rounded-field px-3 text-[0.8125rem] sm:h-7">Show</Button>
          </form>
        )}
        {selected
          ? <LinkButton href={`/runs/${selected.id}`} variant="default" className="ml-auto max-sm:ml-0">Open payroll<ArrowRight aria-hidden className="size-3.5" /></LinkButton>
          : payroll && <LinkButton href="#start-run" variant="default" className="ml-auto max-sm:ml-0">Open payroll<ArrowRight aria-hidden className="size-3.5" /></LinkButton>}
      </div>
      <p className="mt-1 mb-5 text-muted-foreground">
        {company.name}{selected && <> · Pay policy v{selected.config_version} · <b className="text-xs font-semibold tracking-wide text-foreground">{selected.mode === "SIMULATION" ? "SIMULATION" : "LIVE TESTNET"}</b>{selected.mode === "SIMULATION" ? ": this run never pays." : `: payments settle in Arc testnet USDC only after approval; live payments are ${company.live_payments_enabled ? "on" : "off"}.`}</>}
      </p>

      {setup.done < setup.total && <SetupChecklist items={setup.items} done={setup.done} total={setup.total} />}

      {selected && reviewUnavailable && <section className="mt-5 panel"><h2 className="text-lg">Review readiness unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Review readiness could not be loaded. No readiness or handoff outcome can be inferred.</p><Link href={`/runs/${selected.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open this run to retry</Link></section>}

      {selected && period ? <>
        <ReadinessPanel
          mode={reviewSummary ? (reviewSummary.readiness.ready ? "ready" : "blocked") : "progress"}
          title={reviewSummary ? (reviewSummary.readiness.ready ? "Ready for review" : "Not ready to approve yet") : "Run progress"}
          runLabel={runLabel}
          blockerCount={blockerCount}
          checkedAt={now.toISOString()}
          timeZone={timeZone}
          steps={readinessSteps({ runId: selected.id, status: selected.status, mode: selected.mode, policyVersion: selected.config_version, openExceptions: period.openExceptions, liveEnabled: company.live_payments_enabled, signedOff: reviewSummary ? !!reviewSummary.review.signoff : null, inputs: reviewSummary?.settings ? { received: reviewSummary.readiness.received, expected: reviewSummary.readiness.expected } : null, matched: period.autoMatched, canPayroll: payroll, canPay: payment })}
          blockers={blockers}
          moreBlockers={moreBlockers}
          runHref={`/exceptions?run=${selected.id}`}
          facts={{
            cutoff: reviewSummary ? (cutoff ? { at: cutoff.at, zone: cutoff.timeZone, daysText: daysLeftText(daysUntil(cutoff.at, now)) } : null) : undefined,
            payDate: payDateFor(profile.profile.payFrequency, profile.profile.payDay, selected.period_end),
            matched: period.autoMatched,
            inputs: reviewSummary ? (reviewSummary.settings ? { received: reviewSummary.readiness.received, expected: reviewSummary.readiness.expected } : null) : undefined,
          }}
          handoff={handoff}
          workerNote={blockers.some((b) => b.code)}
        />
        {selected.mode === "SIMULATION" && <p className="mt-3 text-xs text-muted-foreground">Simulation ends with validated calculation and variance review. It creates no payment obligations.</p>}

        {tiles && workers && <StatTiles data={{
          months: { year: Number(selected.period_end.slice(0, 4)), cells: tiles.cells, settled: tiles.settled, capped: runs.length >= 20 },
          toPay: { month: monthName(selected.period_end), value: period.netTotal, hiddenForRole: !financial, openExceptions: period.openExceptions, simulation: selected.mode === "SIMULATION" },
          paid,
          workers,
        }} />}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TodoPanel todos={todos} roleText={roleText} cutoff={cutoffText} />
          <ActivityPanel items={period.activity.items} unavailable={period.activity.unavailable} truncated={!!period.activity.graphTruncated} viewAllHref={`/audit?run=${selected.id}`} />
        </div>
      </> : periodUnavailable ? <section className="mt-5 panel"><h2 className="text-lg">Period details unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Period evidence could not be loaded. No counts, totals or payment readiness can be inferred. Retry after checking database readiness.</p></section> : <Panel id="first-h" title="Your first payroll period" className="mt-5"><div className="p-4"><p className="text-muted-foreground">Approve a policy and start a run to see its progress and recorded metrics.</p><Link className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-8" href="/audit">View company audit history</Link></div></Panel>}

      {payroll && (
        <Panel id="start-run-h" anchor="start-run" title="Start a run" className="mt-5">
          <div className="px-4 pb-4"><NewRunForm /></div>
        </Panel>
      )}

      <Panel id="pay-runs-h" anchor="pay-runs" title="Pay runs" className="mt-5">
        <div className="p-4">
          {runs.length === 0 ? (
            <p className="text-muted-foreground">No runs yet.</p>
          ) : (
            <><TableView {...runTable} /><p className="mt-3 text-xs text-muted-foreground">Choose a period above to see its progress, or open a run from its cell context.</p></>
          )}
        </div>
      </Panel>
    </>
  );
}
