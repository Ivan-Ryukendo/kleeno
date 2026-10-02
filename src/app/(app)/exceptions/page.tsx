import Link from "next/link";
import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { CategoryPanel, RunChecksButton, type ExceptionRow } from "@/components/exception-panels";
import { RecordTabs } from "@/components/record-tabs";
import { StatusPill } from "@/components/status-pill";
import { RECON_CATEGORIES } from "@/core/reconciliation";
import { isPayrollRole } from "@/core/workflow";
import { navFor, pageSession } from "@/server/auth/page-session";
import { must } from "@/server/db/client";
import { listExceptions, matchSummary } from "@/server/db/reconciliation";
import { initialTable } from "@/server/db/table-views";

export const metadata = { title: "Exceptions · Kleeno" };

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const canEdit = isPayrollRole(actor.roles);
  const runs = must(await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).neq("status", "DRAFT").order("created_at", { ascending: false }).limit(20), "runs read");
  const { run: wanted } = await searchParams;
  const run = runs.find((r) => r.id === wanted) ?? runs[0];
  const rows = run ? await listExceptions(client, actor.companyId, run.id) : [];
  const summary = run && run.status !== "DATA_IMPORTED" ? await matchSummary(client, actor.companyId, run.id) : null;
  const tables = run ? await Promise.all((["timesheets", "leave", "exceptions"] as const).map((t) => initialTable(client, actor.companyId, actor.roles, t, run.id))) : [];

  return (
    <>
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Exceptions
        </p>
        <h1 className="mt-4 text-5xl">Nothing slips past</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Kleeno checks your imported data and flags anything unclear, with the evidence. An AI reviewer may suggest a decision, but only you decide. A run cannot be calculated while anything is open.</p>

        {!run ? (
          <p className="mt-10 text-muted-foreground">
            No run has data yet. <Link href="/import" className="underline underline-offset-4">Import data</Link> first.
          </p>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {runs.map((r) => (
                <Link key={r.id} href={`/exceptions?run=${r.id}`} className={`rounded-full border px-4 py-2 text-sm ${r.id === run.id ? "border-primary bg-primary text-primary-foreground" : "border-primary/50 bg-white"}`}>
                  {r.period_start} to {r.period_end}
                </Link>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <StatusPill status={run.mode} />
              <StatusPill status={run.status} />
              {summary && summary.total > 0 && (
                <span className="text-sm">
                  {summary.autoMatched + summary.afterReview} of {summary.total} records matched ({summary.autoMatched} automatically, {summary.afterReview} after review); <span className={summary.needReview ? "font-medium text-signal" : ""}>{summary.needReview} need review</span>
                </span>
              )}
            </div>

            {run.status === "DATA_IMPORTED" && canEdit && (
              <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
                <h2 className="text-2xl">Ready to check</h2>
                <p className="mt-2 text-sm text-muted-foreground">The data for this run is in. Run the checks to find duplicates, conflicts, unapproved hours and missing time.</p>
                <RunChecksButton runId={run.id} />
              </section>
            )}
            {rows.length === 0 && run.status !== "DATA_IMPORTED" && <p className="mt-8 text-muted-foreground">No exceptions for this run.</p>}
            {run.status === "READY_FOR_CALCULATION" && <p className="mt-8 font-medium">Everything is resolved. This run is ready to calculate.</p>}

            {RECON_CATEGORIES.map((c) => {
              const inCat: ExceptionRow[] = rows.filter((r) => r.category === c);
              return inCat.length ? <CategoryPanel key={c} runId={run.id} category={c} rows={inCat} canEdit={canEdit} /> : null;
            })}
            {tables.length > 0 && (
              <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
                <h2 className="text-2xl">Every imported record</h2>
                <p className="mt-2 text-sm text-muted-foreground">Each record shows whether it matched automatically, matched after your review, or still needs a decision. Choose columns, filter, sort and export.</p>
                <RecordTabs tables={tables} />
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
