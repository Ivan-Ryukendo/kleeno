import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { ApproveRunForm, CalculateButton, ResumeObligationsButton, SubmitForApprovalButton } from "@/components/run-actions";
import { TableView } from "@/components/table-view";
import { StatusPill } from "@/components/status-pill";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { initialTable } from "@/server/db/table-views";
import { runView } from "@/server/db/views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();
  const view = await runView(client, actor.companyId, runId);
  if (!view) notFound();
  const { run, lines, obligations, calculationHash, netTotal, variance } = view;
  const canEdit = isPayrollRole(actor.roles);
  const summary = lines.length ? await initialTable(client, actor.companyId, actor.roles, "lines", run.id) : null;
  const link = "underline underline-offset-4";

  return (
    <>
      <PageHeader title={`Pay run ${run.period_start} to ${run.period_end}`} description={<span className="font-mono text-xs break-all">{run.id}</span>} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatusPill status={run.mode} />
        <StatusPill status={run.status} />
        <span className="text-sm text-muted-foreground">config v{run.config_version}</span>
      </div>
      {calculationHash && (
        <p className="mt-4 break-all text-sm text-muted-foreground">
          calculation hash <span className="font-mono">{calculationHash}</span>
        </p>
      )}

      <section className="mt-6 panel">
        <h2 className="text-lg">Next step</h2>
        {run.status === "DRAFT" && (
          <p className="mt-3">
            This run has no data yet. <Link href="/import" className={link}>Import timesheets and leave</Link>.
          </p>
        )}
        {["DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING"].includes(run.status) && (
          <p className="mt-3">
            Check the data and settle anything unclear on <Link href={`/exceptions?run=${run.id}`} className={link}>Exceptions</Link>.
          </p>
        )}
        {run.status === "READY_FOR_CALCULATION" && (
          <>
            <p className="mt-3">Everything is resolved. The engine calculates pay from the reconciled data; no AI is involved.</p>
            {canEdit && <CalculateButton runId={run.id} />}
          </>
        )}
        {run.status === "CALCULATION_VALIDATED" && run.mode === "SIMULATION" && <p className="mt-3 font-medium">Simulation complete. This run cannot create obligations or pay (arc testnet USDC, no real funds). Start a live testnet run to pay.</p>}
        {run.status === "CALCULATION_VALIDATED" && run.mode !== "SIMULATION" && (
          <>
            <p className="mt-3">Calculated and checked: {lines.length} payments, {netTotal} USDC. Send it to the payroll approver. Nothing is paid by this.</p>
            {canEdit && <SubmitForApprovalButton runId={run.id} />}
          </>
        )}
        {run.status === "PENDING_APPROVAL" &&
          (canEdit && calculationHash ? (
            <ApproveRunForm runId={run.id} total={netTotal} count={lines.length} calculationHash={calculationHash} />
          ) : (
            <p className="mt-3">Waiting for the payroll approver to approve this calculation.</p>
          ))}
        {run.status === "APPROVED" && (
          <>
            <p className="mt-3">Approved, but some payment obligations could not be created yet (a worker may have no wallet, or the wallet is not confirmed). Fix that on <Link href="/workers" className={link}>Workers</Link>, then continue.</p>
            {canEdit && <ResumeObligationsButton runId={run.id} />}
          </>
        )}
        {["OBLIGATIONS_CREATED", "PAYMENT_IN_PROGRESS", "PARTIALLY_SETTLED", "PAYMENT_FAILED", "SETTLED", "RECONCILED"].includes(run.status) && (
          <p className="mt-3">
            Payroll is approved. Payment approvers plan, sign and pay on <Link href={`/settlement?run=${run.id}`} className={link}>Payments</Link>.
          </p>
        )}
        {run.status === "REJECTED" && <p className="mt-3">This run was rejected. Start a new run to pay.</p>}
      </section>

      {summary && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Pay summary</h2>
          <TableView {...summary} />
        </section>
      )}

      <section className="mt-6 panel">
        <h2 className="text-lg">Calculation and trace</h2>
        {lines.length === 0 && <p className="mt-6 text-muted-foreground">Not calculated yet.</p>}
        {lines.map((l) => (
          <div key={l.id} className="mt-6 rounded-box border border-border p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{l.worker}</span>
              <span>
                gross {l.gross} − deductions {l.deductions} = <strong>net {l.net} USDC</strong>
              </span>
            </div>
            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Step</th>
                  <th className="py-1 font-medium">Component</th>
                  <th className="py-1 font-medium">Rule</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {l.trace.map((t) => (
                  <tr key={t.step} className="border-t border-border">
                    <td className="py-2">{t.step}</td>
                    <td className="py-2">{t.component}</td>
                    <td className="py-2">
                      {t.rule} v{t.ruleVersion}
                    </td>
                    <td className="py-2 text-right">{t.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {variance && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Variance: what was paid vs what the rules say</h2>
          {!variance.available ? (
            <p className="mt-4 text-muted-foreground">
              Import the amounts you actually paid to see differences. <Link href="/import" className={link}>Import</Link>.
            </p>
          ) : variance.findings.length === 0 ? (
            <p className="mt-4 font-medium">Everything paid matches the calculation within the tolerance.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Worker</th>
                  <th className="py-1 font-medium">Finding</th>
                  <th className="py-1 text-right font-medium">Should be paid</th>
                  <th className="py-1 text-right font-medium">Was paid</th>
                  <th className="py-1 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {variance.findings.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="py-2">{f.worker}</td>
                    <td className="py-2 font-medium text-signal">{f.kind.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="py-2 text-right">{f.expected}</td>
                    <td className="py-2 text-right">{f.actual}</td>
                    <td className="py-2 text-right">{f.difference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="mt-6 panel">
        <h2 className="text-lg">Obligations</h2>
        {obligations.length === 0 && <p className="mt-6 text-muted-foreground">No obligations for this run.</p>}
        {obligations.map((o) => (
          <div key={o.id} className="mt-6 rounded-box border border-border p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">
                {o.worker} · {o.amount} USDC
              </span>
              <StatusPill status={o.status} />
            </div>
            <p className="mt-3 break-all text-sm text-muted-foreground">
              to <span className="font-mono">{o.recipient}</span>
            </p>
            {o.txUrl && (
              <a href={o.txUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-sm underline underline-offset-4">
                Arc receipt: {o.txHash}
              </a>
            )}
            {o.exception && (
              <p className="mt-3 text-sm font-medium text-signal">
                DO NOT PAY: {o.exception.code}
                {o.exception.reasons.length > 0 && ` (${o.exception.reasons.join(", ")})`}
              </p>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
