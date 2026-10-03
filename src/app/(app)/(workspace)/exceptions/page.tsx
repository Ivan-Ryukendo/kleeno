import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { CategoryPanel, RunChecksButton, type ExceptionRow } from "@/components/exception-panels";
import { RecordTabs } from "@/components/record-tabs";
import { StatusPill } from "@/components/status-pill";
import { RECON_CATEGORIES } from "@/core/reconciliation";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
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
      <PageHeader title="Exceptions" description="Nothing slips past. Kleeno checks your imported data and flags anything unclear, with the evidence. An AI reviewer may suggest a decision, but only you decide. A run cannot be calculated while anything is open." />

      {!run ? (
        <p className="mt-6 text-muted-foreground">
          No run has data yet. <Link href="/import" className="underline underline-offset-4">Import data</Link> first.
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {runs.map((r) => (
              <Link key={r.id} href={`/exceptions?run=${r.id}`} className={`rounded-field border px-3 py-1.5 text-sm ${r.id === run.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
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
            <section className="mt-6 panel">
              <h2 className="text-lg">Ready to check</h2>
              <p className="mt-2 text-sm text-muted-foreground">The data for this run is in. Run the checks to find duplicates, conflicts, unapproved hours and missing time.</p>
              <RunChecksButton runId={run.id} />
            </section>
          )}
          {rows.length === 0 && run.status !== "DATA_IMPORTED" && <p className="mt-6 text-muted-foreground">No exceptions for this run.</p>}
          {run.status === "READY_FOR_CALCULATION" && <p className="mt-6 font-medium">Everything is resolved. This run is ready to calculate.</p>}

          {RECON_CATEGORIES.map((c) => {
            const inCat: ExceptionRow[] = rows.filter((r) => r.category === c);
            return inCat.length ? <CategoryPanel key={c} runId={run.id} category={c} rows={inCat} canEdit={canEdit} /> : null;
          })}
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
