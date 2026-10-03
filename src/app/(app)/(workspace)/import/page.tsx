import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { ImportWizard } from "@/components/import-wizard";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { must } from "@/server/db/client";

export const metadata = { title: "Import · Kleeno" };

export default async function ImportPage() {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const canEdit = isPayrollRole(actor.roles);

  const runs = must(await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).in("status", ["DRAFT", "DATA_IMPORTED"]).order("created_at", { ascending: false }), "runs read");
  const workers = must(await client.from("workers").select("pseudonym").eq("company_id", actor.companyId), "workers read");
  const batches = must(await client.from("import_batches").select("id, run_id, import_type, row_count, rejected_count, created_at").eq("company_id", actor.companyId).order("created_at", { ascending: false }).limit(20), "batches read");
  const nextCode = Math.max(0, ...workers.map((w) => Number(w.pseudonym.slice(1)))) + 1;
  const label = (r: (typeof runs)[number]) => `${r.period_start} to ${r.period_end} · ${r.mode === "SIMULATION" ? "simulation" : "live testnet"} · ${r.status.replaceAll("_", " ").toLowerCase()}`;

  return (
    <>
      <PageHeader title="Import" description="Bring in your data. Upload timesheets, leave and what you actually paid. Your file is read in this browser; names are replaced by worker codes before anything is sent, and the file itself is never stored." />

      {canEdit ? (
        <section className="mt-6 panel">
          <h2 className="text-lg">New import</h2>
          <ImportWizard runs={runs.map((r) => ({ id: r.id, label: label(r) }))} workerCodes={workers.map((w) => w.pseudonym)} nextCode={nextCode} />
        </section>
      ) : (
        <p className="mt-6 text-muted-foreground">The payroll approver imports data.</p>
      )}

      <section className="mt-6 panel">
        <h2 className="text-lg">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 text-right font-medium">Rows</th>
                <th className="py-2 text-right font-medium">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-2 pr-4">{new Date(b.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4">{b.import_type.replaceAll("_", " ").toLowerCase()}</td>
                  <td className="py-2 pr-4 text-right">{b.row_count}</td>
                  <td className="py-2 text-right">{b.rejected_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
