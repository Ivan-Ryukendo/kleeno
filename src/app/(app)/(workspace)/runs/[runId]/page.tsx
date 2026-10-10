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
import { RunAdjustmentsForm } from "@/components/worker-forms";
import { listWorkers } from "@/server/db/workers";
import { loadRunAdjustments } from "@/server/db/calculate";
import { PayrollReviewPanel } from "@/components/payroll-review-panel";
import { reviewerWorkspace } from "@/server/db/reviewer-workspace";
import { ReviewTaskPanel } from "@/components/review-task-panel";
import { RunViewNavigation } from "@/components/run-view-navigation";
import { isPaymentRole } from "@/core/tenancy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ baseline?: string | string[] }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();
  const view = await runView(client, actor.companyId, runId, actor.roles);
  if (!view) notFound();
  const { run, lines, obligations, calculationHash, netTotal, variance } = view;
  const canInspect = view.financial;
  const canEdit = isPayrollRole(actor.roles);
  const canAdjust = canEdit && ["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING", "READY_FOR_CALCULATION"].includes(run.status);
  const adjustmentWorkers = canAdjust ? await listWorkers(client, actor.companyId) : [];
  const adjustments = canAdjust ? Object.fromEntries(await loadRunAdjustments(client, actor.companyId, run.id)) : {};
  const summary = canInspect && lines.length ? await initialTable(client, actor.companyId, actor.roles, "lines", run.id) : null;
  const { baseline } = await searchParams;
  let reviewData: Awaited<ReturnType<typeof reviewerWorkspace>> | null = null;
  try {
    if (canInspect) reviewData = await reviewerWorkspace(client, actor, run.id, typeof baseline === "string" ? baseline : undefined);
  } catch {
    // A failed evidence read must not imply readiness or expose review actions.
  }
  const link = "underline underline-offset-4";

  return (
    <>
      <PageHeader title={`Pay run ${run.period_start} to ${run.period_end}`} description={<span className="font-mono text-xs break-all">{run.id}</span>} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatusPill status={run.mode} />
        <StatusPill status={run.status} />
        <span className="text-sm text-muted-foreground">config v{run.config_version}</span>
      </div>
      <RunViewNavigation runId={run.id} current="table" mode={run.mode} canPay={isPaymentRole(actor.roles)} />
      {canInspect && calculationHash && (
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
            <p className="mt-3">{canInspect ? <>Calculated and checked: {lines.length} payments, {netTotal} USDC. Send it to the payroll approver. Nothing is paid by this.</> : "The calculation is checked. A payroll reviewer can continue."}</p>
            {canEdit && <SubmitForApprovalButton runId={run.id} />}
          </>
        )}
        {run.status === "PENDING_APPROVAL" &&
          (canEdit && calculationHash && netTotal !== null ? (
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

      {canInspect ? <>
      {canEdit && <ReviewTaskPanel key={`${actor.companyId}:${run.id}`} runId={run.id} />}
      {canAdjust && <section className="mt-6 panel"><h2 className="text-lg">One-off pay inputs</h2><p className="mt-2 text-sm text-muted-foreground">Review bonuses, commissions, reimbursements and fixed deductions before calculation. Every input needs a reason.</p><RunAdjustmentsForm key={run.id} runId={run.id} workers={adjustmentWorkers.map((w) => ({ id: w.id, pseudonym: w.pseudonym }))} initial={adjustments} /></section>}

      {reviewData ? <PayrollReviewPanel key={`${run.id}:${reviewData.review.calculationId ?? "uncalculated"}:${reviewData.review.revision}:${reviewData.settings?.revision ?? 0}:${reviewData.selectedBaselineId ?? "none"}`} runId={run.id} data={reviewData} /> : <section className="mt-6 panel"><h2 className="text-lg">Review workspace unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Readiness and review evidence could not be loaded. No review action is available until the evidence loads.</p><Link href={`/runs/${run.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Reload this run</Link></section>}

      {summary && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Pay summary</h2>
          <TableView {...summary} />
        </section>
      )}

      <section id="calculation-trace" className="mt-6 scroll-mt-20 panel">
        <h2 className="text-lg">Calculation and trace</h2>
        {lines.length > 0 && <p className="mt-2 text-sm text-muted-foreground">Recorded steps from the deterministic calculation, using config v{run.config_version}. Open a pay-summary cell to jump to its worker’s trace.</p>}
        {lines.length === 0 && <p className="mt-6 text-muted-foreground">Not calculated yet.</p>}
        {lines.map((l) => (
          <div key={l.id} id={`trace-${l.id}`} tabIndex={-1} aria-label={`Calculation trace for ${l.worker}`} className="mt-6 scroll-mt-20 rounded-box border border-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{l.worker}</span>
              <span>
                gross {l.gross} − deductions {l.deductions} = <strong>net {l.net} USDC</strong>
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">Calculation steps for {l.worker}, config version {run.config_version}; amounts in USDC.</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Step</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Component</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Rule</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Source and inputs</th>
                  <th scope="col" className="py-1 text-right font-medium">Amount (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {l.trace.map((t) => (
                  <tr key={t.step} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 font-normal tabular-nums">{t.step}</th>
                    <td className="py-2 pr-3">{t.component}</td>
                    <td className="py-2 pr-3">
                      {t.rule} v{t.ruleVersion}
                    </td>
                    <td className="max-w-72 py-2 pr-3">
                      <p className="break-words">{t.source}</p>
                      <dl className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {Object.entries(t.inputs).map(([name, value]) => <div key={name} className="flex flex-wrap gap-x-2"><dt className="break-words">{name}</dt><dd className="break-words font-mono">{value}</dd></div>)}
                      </dl>
                    </td>
                    <td className="py-2 text-right tabular-nums">{t.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
            <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Actual imported payments compared with deterministic calculated pay; amounts in USDC.</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Worker</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Finding</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Should be paid</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Was paid</th>
                  <th scope="col" className="py-1 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {variance.findings.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 font-normal">{f.worker}</th>
                    <td className="py-2 pr-3 font-medium text-signal">{f.kind.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{f.expected}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{f.actual}</td>
                    <td className="py-2 text-right tabular-nums">{f.difference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
      </> : <section className="mt-6 panel"><h2 className="text-lg">Financial details unavailable</h2><p className="mt-3 text-sm text-muted-foreground">Your role cannot inspect calculation amounts or review evidence. Ask the company owner for access.</p></section>}
    </>
  );
}
