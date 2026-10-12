import Link from "next/link";
import { notFound } from "next/navigation";
import { RunFrame } from "@/components/payroll/run-frame";
import { loadFrameData } from "@/components/payroll/frame-data";
import { Panel } from "@/components/dashboard/ui";
import { isPaymentRole } from "@/core/tenancy";
import { uuid } from "@/server/schemas";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { ImportWizard } from "@/components/import-wizard";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { must } from "@/server/db/client";

export const metadata = { title: "Import · Kleeno" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const canEdit = isPayrollRole(actor.roles);
  const { run: wanted } = await searchParams;
  if (wanted && !uuid.safeParse(wanted).success) notFound();
  const selectedRead = wanted ? await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).eq("id", wanted).maybeSingle() : null;
  if (selectedRead?.error) throw new Error("import run read failed");
  const selected = selectedRead?.data;
  if (wanted && !selected) notFound();
  const frame = selected ? await loadFrameData(client, actor, selected.id) : null;

  const runs = must(await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).in("status", ["DRAFT", "DATA_IMPORTED"]).order("created_at", { ascending: false }), "runs read");
  const workers = must(await client.from("workers").select("pseudonym").eq("company_id", actor.companyId), "workers read");
  let batchesQuery = client.from("import_batches").select("id, run_id, import_type, row_count, rejected_count, created_at").eq("company_id", actor.companyId);
  if (selected) batchesQuery = batchesQuery.eq("run_id", selected.id);
  const batches = must(await batchesQuery.order("created_at", { ascending: false }).limit(20), "batches read");
  const options = selected ? runs.filter(r => r.id === selected.id && ["DRAFT", "DATA_IMPORTED"].includes(r.status)) : runs;
  const nextCode = Math.max(0, ...workers.map((w) => Number(w.pseudonym.slice(1)))) + 1;
  const label = (r: (typeof runs)[number]) => `${r.period_start} to ${r.period_end} · ${r.mode === "SIMULATION" ? "simulation" : "live testnet"} · ${r.status.replaceAll("_", " ").toLowerCase()}`;

  return (
    <>
      {selected && frame ? <RunFrame run={{ id: selected.id, mode: selected.mode, status: selected.status, periodStart: selected.period_start, periodEnd: selected.period_end }} current={null} data={frame} canPayroll={canEdit} canPay={isPaymentRole(actor.roles)} hrefFor={id => `/import?run=${id}`} hint="Import · CSV or Excel" /> : <PageHeader title="Payroll" description="Import timesheets, leave and amounts actually paid into an open payroll run." />}
      <div role="note" className="mt-6 rounded-field border bg-sidebar p-4 text-sm"><b className="font-medium">Names stay on this computer.</b> Your file is read in this browser; names are replaced by worker codes before anything is sent. The original file and name key are never stored by Kleeno.</div>
      {selected && <Link href={`/runs/${selected.id}`} className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Back to Payroll table</Link>}

      {canEdit ? (
        <Panel id="new-import-heading" title="Import data" className="mt-6"><div className="p-4">
          {selected && options.length === 0 ? <p className="text-sm text-muted-foreground">This run is closed for imports. Its recorded evidence remains below. Choose a draft or data-imported run to add data.</p> : <ImportWizard key={`${actor.companyId}:${actor.userId}:${selected?.id ?? "company"}`} contextKey={`${actor.companyId}:${actor.userId}`} runs={options.map((r) => ({ id: r.id, label: label(r) }))} workerCodes={workers.map((w) => w.pseudonym)} nextCode={nextCode} />}
        </div></Panel>
      ) : (
        <p className="mt-6 text-muted-foreground">The payroll approver imports data.</p>
      )}

      <Panel id="recent-imports-heading" title="Recent imports" className="mt-6"><div className="p-4">
        {batches.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Recent imports" tabIndex={0}><table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Recorded import batches, newest first; times in UTC</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">When</th>
                <th scope="col" className="py-2 pr-4 font-medium">Data</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Rows</th>
                <th scope="col" className="py-2 text-right font-medium">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-2 pr-4">{new Date(b.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"}</td>
                  <td className="py-2 pr-4">{b.import_type.replaceAll("_", " ").toLowerCase()}</td>
                  <td className="py-2 pr-4 text-right">{b.row_count}</td>
                  <td className="py-2 text-right">{b.rejected_count}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div></Panel>
    </>
  );
}
