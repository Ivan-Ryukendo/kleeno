import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { connection } from "next/server";
import { Chip } from "@/components/dashboard/ui";
import { PageHeader } from "@/components/shell/page-header";
import { ACTION_LABEL, CATEGORY_LABEL } from "@/components/exception-labels";
import { CategoryPanel, ResolveException, RunChecksButton, type ExceptionRow } from "@/components/exception-panels";
import { loadFrameData } from "@/components/payroll/frame-data";
import { RunFrame } from "@/components/payroll/run-frame";
import { RecordTabs } from "@/components/record-tabs";
import { StatusPill } from "@/components/status-pill";
import { payrollSide } from "@/components/shell/nav-config";
import { isPaymentRole } from "@/core/tenancy";
import { RECON_CATEGORIES, describeFacts } from "@/core/reconciliation";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { must } from "@/server/db/client";
import { listExceptions, matchSummary } from "@/server/db/reconciliation";
import { initialTable } from "@/server/db/table-views";
import { cn } from "@/lib/utils";

export const metadata = { title: "Needs review · Kleeno" };

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** The selected item: why it was flagged, the stored evidence, what an AI suggested (never applied) and the separate resolve step. */
function Inspector({ row, canEdit }: { row: ExceptionRow; canEdit: boolean }) {
  const closed = row.status === "RESOLVED";
  const facts = Object.entries(row.facts);
  return (
    <article aria-labelledby="inspector-heading" className="min-w-0 rounded-card border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h3 id="inspector-heading" className="text-base font-medium">{row.worker}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{CATEGORY_LABEL[row.category]}</p>
        </div>
        <StatusPill status={row.status} />
      </header>
      <section aria-label="Why this was flagged" className="border-b p-4">
        <h4 className="text-xs font-medium text-muted-foreground">Why this was flagged</h4>
        <p className="mt-2 rounded-field bg-secondary p-3 text-sm font-medium">{describeFacts(row.category, row.facts)}</p>
        {facts.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-field border p-2.5">
                <dt className="text-xs text-muted-foreground">{humanize(k)}</dt>
                <dd className="mt-0.5 text-sm font-medium break-words tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-label="Evidence" className="border-b p-4">
        <h4 className="text-xs font-medium text-muted-foreground">Evidence</h4>
        <p className="mt-2 text-sm">{row.recordCount} imported {row.recordCount === 1 ? "record" : "records"} support this finding. Selecting an item only shows its evidence.</p>
      </section>
      {row.suggestion && !closed && (
        <section aria-label="AI suggestion" className="border-b p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles aria-hidden="true" className="size-3.5" />Suggested by AI, not applied</h4>
          <p className="mt-2 text-sm font-medium">{ACTION_LABEL[row.suggestion.action]}</p>
          <p className="mt-1 text-xs text-muted-foreground">{row.suggestion.confidence.toLowerCase()} confidence. This suggestion does not change pay; your decision does.</p>
        </section>
      )}
      {closed ? (
        <section aria-label="Decision" className="p-4">
          <h4 className="text-xs font-medium text-muted-foreground">Decision</h4>
          <p className="mt-2 text-sm font-medium">{row.decision ? ACTION_LABEL[row.decision] : "Resolved"}</p>
          {row.note && <p className="mt-1 text-sm text-muted-foreground">Note: {row.note}</p>}
          <p className="mt-3 text-xs text-muted-foreground">Closed items cannot be edited. A correction opens a new item and keeps this one on record.</p>
        </section>
      ) : canEdit ? (
        <section aria-label="Resolve" className="p-4">
          <h4 className="text-xs font-medium text-muted-foreground">Resolve</h4>
          <p className="mt-2 text-xs text-muted-foreground">Your decision and note go to Activity and cannot be edited later. Resolving does not approve the run.</p>
          <ResolveException row={row} />
        </section>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Your role can read this item but not resolve it.</p>
      )}
    </article>
  );
}

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ run?: string; tab?: string; item?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const canEdit = isPayrollRole(actor.roles);
  const runs = must(await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).neq("status", "DRAFT").order("created_at", { ascending: false }).limit(20), "runs read");
  const { run: wanted, tab, item } = await searchParams;
  const run = runs.find((r) => r.id === wanted) ?? runs[0];
  const rows = run ? await listExceptions(client, actor.companyId, run.id) : [];
  const summary = run && run.status !== "DATA_IMPORTED" ? await matchSummary(client, actor.companyId, run.id) : null;
  const tables = run ? await Promise.all((["timesheets", "leave", "exceptions"] as const).map((t) => initialTable(client, actor.companyId, actor.roles, t, run.id))) : [];
  const frame = run ? await loadFrameData(client, actor, run.id) : null;

  const isClosed = (r: ExceptionRow) => r.status === "RESOLVED";
  const open = rows.filter((r) => !isClosed(r));
  const closed = rows.filter(isClosed);
  const showClosed = tab === "closed";
  const list = showClosed ? closed : open;
  const selected = list.find((r) => r.id === item) ?? list[0];
  const href = (over: { tab?: string; item?: string }) => {
    const q = new URLSearchParams({ run: run?.id ?? "" });
    if (over.tab) q.set("tab", over.tab);
    if (over.item) q.set("item", over.item);
    return `/exceptions?${q}`;
  };
  const tabClass = (on: boolean) => cn("inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[0.8125rem] font-medium sm:min-h-9", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground", focus);

  return (
    <>
      {run && frame ? (
        <RunFrame run={{ id: run.id, mode: run.mode, status: run.status, periodStart: run.period_start, periodEnd: run.period_end }} current={null} data={frame} canPayroll={payrollSide(actor.roles)} canPay={isPaymentRole(actor.roles)} hrefFor={(id) => `/exceptions?run=${id}`} hint={open.length ? "Approval opens when exceptions are closed" : "No open exceptions"} />
      ) : (
        <PageHeader title="Payroll" description="No pay run has data yet." />
      )}

      {!run ? (
        <p className="mt-6 text-muted-foreground">
          No run has data yet. <Link href="/import" className="underline underline-offset-4">Import data</Link> first.
        </p>
      ) : (
        <>
          <Link href={`/runs/${run.id}`} className={`mt-8 inline-flex min-h-11 items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground sm:min-h-0 ${focus}`}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Payroll table
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-xl font-medium tracking-tight">Needs review</h2>
            {open.length > 0 ? <Chip tone="risk">{open.length} open</Chip> : rows.length > 0 ? <Chip tone="ok">All closed</Chip> : null}
            <p className="text-[0.8125rem] text-muted-foreground">Nothing slips past: Kleeno flags anything unclear, with the evidence. An AI reviewer may suggest, only you decide. A run cannot be calculated while anything is open.</p>
          </div>
          {summary && summary.total > 0 && (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              {summary.autoMatched + summary.afterReview} of {summary.total} records matched ({summary.autoMatched} automatically, {summary.afterReview} after review); <span className={summary.needReview ? "font-medium text-signal" : ""}>{summary.needReview} need review</span>
            </p>
          )}

          {run.status === "DATA_IMPORTED" && canEdit && (
            <section className="mt-6 panel">
              <h2 className="text-lg">Ready to check</h2>
              <p className="mt-2 text-sm text-muted-foreground">The data for this run is in. Run the checks to find duplicates, conflicts, unapproved hours and missing time.</p>
              <RunChecksButton runId={run.id} />
            </section>
          )}
          {run.status === "READY_FOR_CALCULATION" && <p className="mt-4 font-medium">Everything is resolved. This run is ready to calculate.</p>}

          {rows.length === 0 && run.status !== "DATA_IMPORTED" ? (
            <p className="mt-6 text-muted-foreground">No exceptions for this run.</p>
          ) : (
            rows.length > 0 && (
              <>
                <nav aria-label="Review items" className="mt-5 flex gap-1 border-b">
                  <Link href={href({})} aria-current={!showClosed ? "page" : undefined} className={tabClass(!showClosed)}>Open <span className="text-muted-foreground">{open.length}</span></Link>
                  <Link href={href({ tab: "closed" })} aria-current={showClosed ? "page" : undefined} className={tabClass(showClosed)}>Resolved and closed <span className="text-muted-foreground">{closed.length}</span></Link>
                </nav>
                {list.length === 0 ? (
                  <p className="mt-6 text-muted-foreground">{showClosed ? "Nothing has been resolved yet." : "No open items. Everything flagged has a decision."}</p>
                ) : (
                  <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <ul aria-label={showClosed ? "Resolved and closed items" : "Open items"} className="min-w-0 divide-y overflow-hidden rounded-card border bg-card">
                      {list.map((r) => (
                        <li key={r.id}>
                          <Link href={href({ tab: showClosed ? "closed" : undefined, item: r.id })} aria-current={selected?.id === r.id ? "true" : undefined} className={cn("block min-h-11 px-3 py-2.5 hover:bg-accent", selected?.id === r.id && "bg-accent", focus)}>
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{r.worker}</span>
                              <StatusPill status={r.status} />
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{CATEGORY_LABEL[r.category]}</span>
                            {r.suggestion && !isClosed(r) && <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Sparkles aria-hidden="true" className="size-3" />AI suggestion</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {selected && <Inspector row={selected} canEdit={canEdit} />}
                  </div>
                )}
                {canEdit && open.length > 1 && (
                  <details className="mt-6 rounded-card border">
                    <summary className={`min-h-11 cursor-pointer rounded-card px-4 py-3 text-sm font-medium ${focus}`}>Settle several together, by category</summary>
                    <div className="px-4 pb-4">
                      {RECON_CATEGORIES.map((c) => {
                        const inCat: ExceptionRow[] = rows.filter((r) => r.category === c);
                        return inCat.length ? <CategoryPanel key={c} runId={run.id} category={c} rows={inCat} canEdit={canEdit} /> : null;
                      })}
                    </div>
                  </details>
                )}
              </>
            )
          )}
          {tables.length > 0 && (
            <section className="mt-6 panel">
              <h2 className="text-lg">Every imported record</h2>
              <p className="mt-2 text-sm text-muted-foreground">Each record shows whether it matched automatically, matched after your review, or still needs a decision. Choose columns, filter, sort and export.</p>
              <RecordTabs tables={tables} />
            </section>
          )}
        </>
      )}
    </>
  );
}
