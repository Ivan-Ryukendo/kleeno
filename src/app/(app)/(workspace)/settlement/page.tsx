import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunFrame } from "@/components/payroll/run-frame";
import { loadFrameData } from "@/components/payroll/frame-data";
import { Chip } from "@/components/dashboard/ui";
import { PageHeader } from "@/components/shell/page-header";
import { LivePaymentsPanel, PayControls, PlanForm, ReceiptLinkButton, SignForm, StandingAuthorizationsPanel, TopUpPanel } from "@/components/settlement-actions";
import { StatusPill } from "@/components/status-pill";
import { isOwner, isPayrollRole } from "@/core/tenancy";
import { isPaymentRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { settlementView } from "@/server/db/settlement";
import { listStanding } from "@/server/db/standing";

export const metadata = { title: "Payments · Kleeno" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const card = "rounded-card border bg-card p-4";
const PLANNABLE = ["OBLIGATIONS_CREATED", "PARTIALLY_SETTLED", "PAYMENT_FAILED"];

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const { run: wanted } = await searchParams;
  const owner = isOwner(actor.roles);
  if (!isPayrollRole(actor.roles) && !isPaymentRole(actor.roles)) {
    const result = owner ? await client.from("companies").select("live_status, live_payments_enabled, is_demo, is_sandbox").eq("id", actor.companyId).single() : null;
    const metadata = result && !result.error ? result.data : null;
    return <>
      <PageHeader title="Payments" description="Settlement amounts and payment details require financial reviewer access." />
      <section className={card} aria-labelledby="financial-access-heading"><h2 id="financial-access-heading" className="text-lg">Financial access required</h2><p className="mt-3 text-sm text-muted-foreground">Your current membership cannot inspect payment amounts, recipients or wallet details. HR, payroll and payment reviewers can inspect this evidence.</p><Link href="/dashboard" className="mt-3 inline-flex min-h-11 items-center rounded-field text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Return to Home</Link></section>
      {owner && <section className={card} aria-labelledby="live-control-heading"><h2 id="live-control-heading" className="text-lg">Live payments</h2>{metadata ? <><div className="mt-3"><StatusPill status={metadata.live_payments_enabled ? "ON" : "OFF"} /></div>{metadata.is_demo || metadata.is_sandbox ? <p className="mt-3 text-sm text-muted-foreground">This is a demo company: it runs in simulation only and never pays.</p> : <LivePaymentsPanel liveStatus={metadata.live_status} enabled={metadata.live_payments_enabled} isOwner canSwitchOff />}</> : <p role="alert" className="mt-3 text-sm text-signal">Live-payment controls could not be loaded. Reload this page to check current status.</p>}<p className="mt-3 text-sm text-muted-foreground">Owner controls do not grant financial reviewer access or authorize an individual payment.</p></section>}
    </>;
  }
  if (wanted && !UUID.test(wanted)) notFound();
  const view = await settlementView(client, actor.companyId, actor.userId, wanted && UUID.test(wanted) ? wanted : undefined, actor.roles);
  const { company, run, runs } = view;
  if (wanted && run?.id !== wanted) return <><PageHeader title="Payroll" description="Payments for the selected run" /><section className={`mt-6 ${card}`}><h2 className="text-lg">Payments unavailable for this run</h2><p className="mt-3 text-sm text-muted-foreground">Only eligible live testnet runs appear in the payment view. This run is not in the current payment list. Simulation never pays.</p><Link href={`/runs/${wanted}`} className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to selected run</Link></section></>;
  const canPay = isPaymentRole(actor.roles);
  const chosen = run ? runs.find(r => r.id === run.id) : null;
  const frame = run ? await loadFrameData(client, actor, run.id) : null;
  const live = company.live_payments_enabled;
  const standing = canPay && !company.is_demo && !company.is_sandbox
    ? await listStanding({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles })
    : [];
  const active = run?.batch && ["PROPOSED", "AUTHORIZED", "OPEN"].includes(run.batch.status) ? run.batch : null;
  const unpaid = run?.obligations.filter((o) => o.status === "CREATED" || o.status === "ON_HOLD") ?? [];
  const settledCount = run?.obligations.filter((o) => o.status === "SETTLED").length ?? 0;
  const link = "underline underline-offset-4";

  return (
    <>
      {run && chosen && frame ? <RunFrame run={{ id: run.id, mode: "LIVE_TESTNET", status: run.status, periodStart: chosen.period_start, periodEnd: chosen.period_end }} current="payments" data={frame} canPayroll={isPayrollRole(actor.roles)} canPay={canPay} hrefFor={id => `/settlement?run=${id}`} hint={`${settledCount} of ${run.obligations.length} obligations settled · Arc testnet`} /> : <PageHeader title="Payroll" description="Payments · Arc testnet USDC, no real funds. Money moves only exactly as it was signed." />}
      <p role="note" className="mt-6 rounded-field border bg-sidebar p-4 text-sm"><b className="font-medium">Payments require separate authorization.</b> A different approver signs the exact plan. Holds stay excluded. Arc testnet USDC only, no real funds.</p>
      {run && <section aria-label="Payment totals" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "Batch total", value: run.batch ? `${run.batch.total} USDC` : "No plan", hint: run.batch ? `${run.batch.count} payments in the latest plan` : "A payment plan has not been recorded" }, { label: "On hold", value: String(run.obligations.filter(o => o.held).length), hint: "DO NOT PAY · excluded from payment", risk: true }, { label: "Settled", value: String(settledCount), hint: `${run.obligations.length} recorded obligations` }, { label: "Payroll wallet", value: view.balance === null ? "Unavailable" : `${view.balance} USDC`, hint: view.approver ? "Approver wallet · testnet" : "Wallet has not been created" }].map(stat => <div key={stat.label} className="min-w-0 rounded-card border p-4"><p className="text-xs text-muted-foreground">{stat.label}</p><p className={`mt-2 break-words text-xl font-medium tabular-nums ${stat.risk ? "text-signal" : ""}`}>{stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p></div>)}
      </section>}
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">

      {!run ? (
        <section className={card}>
          <h2 className="text-lg">Nothing to pay yet</h2>
          <p className="mt-3 text-muted-foreground">
            A live testnet run appears here once it is sent for approval. Start one from the <Link href="/dashboard#start-run" className={link}>Dashboard</Link>.
          </p>
        </section>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-2 text-sm font-medium">Payment obligations</h2>
              <StatusPill status="LIVE_TESTNET" />
              <StatusPill status={run.status} />
              <Link href={`/runs/${run.id}`} className={`text-sm ${link}`}>
                Review the calculation
              </Link>
            </div>

            {run.batch && <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Chip>{run.batch.status.replaceAll("_", " ").toLowerCase()}</Chip><span>{run.batch.source === "AI" ? "Suggested by AI, not applied" : "Recorded payment plan"}</span><code className="break-all">{run.batch.planHash}</code></div>}
            {run.obligations.length === 0 ? (
              <p className="mt-6 text-muted-foreground">
                {run.status === "PENDING_APPROVAL" ? "Waiting for payroll approval on the run page." : "The payment obligations are created when payroll is approved."}
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {settledCount} of {run.obligations.length} paid
                  {` · total ${run.total} USDC`}
                </p>
                <div className="mt-4 overflow-x-auto" role="region" aria-label="Payment obligations" tabIndex={0}>
                  <table className="w-full min-w-[44rem] text-left text-sm">
                    <caption className="sr-only">Recorded payment obligations with holds, signals and settlement receipts</caption>
                    <thead className="bg-sidebar text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-medium">Worker</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">Amount (USDC)</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Payout wallet</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Flags</th>
                        <th scope="col" className="py-2 font-medium">Arc receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.obligations.map((o) => (
                        <tr key={o.id} className={`border-t border-border align-top ${o.held ? "bg-signal/5" : ""}`}>
                          <td className="py-3 pr-4 font-medium">{o.worker}</td>
                          <td className="py-3 pr-4 text-right">{o.amount}</td>
                          <td className="py-3 pr-4 font-mono text-xs" title={o.recipient}>ends {o.recipient.slice(-6)}</td>
                          <td className="py-3 pr-4">
                            <StatusPill status={o.status} />
                            {o.held && <p className="mt-1 text-xs font-medium text-signal">DO NOT PAY</p>}
                            {o.exception && <p className="mt-1 text-xs font-medium text-signal">DO NOT PAY: {o.exception}</p>}
                          </td>
                          <td className="py-3 pr-4 text-xs">{o.signals.length ? o.signals.map((s) => s.replaceAll("_", " ").toLowerCase()).join(", ") : "—"}</td>
                          <td className="py-3">
                            {o.txUrl ? (
                              <a href={o.txUrl} target="_blank" rel="noreferrer" className={`font-mono text-xs ${link}`}>
                                {o.txHash?.slice(0, 10)}…{o.txHash?.slice(-6)}
                              </a>
                            ) : (
                              "—"
                            )}
                            {o.status === "SETTLED" && canPay && (
                              <div className="mt-1">
                                <ReceiptLinkButton obligationId={o.id} />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-sidebar"><tr><th scope="row" className="py-2 pr-4 font-medium">Total obligations</th><td className="py-2 pr-4 text-right tabular-nums">{run.total}</td><td colSpan={4} className="py-2 text-xs text-muted-foreground">Includes held and unsettled obligations</td></tr></tfoot>
                  </table>
                </div>
              </>
            )}
          </section>

          {PLANNABLE.includes(run.status) && (
            <section className={card}>
              <h2 className="text-lg">Plan and sign</h2>
              {!canPay ? (
                <p className="mt-3 text-muted-foreground">A payment approver reviews the plan and signs it.</p>
              ) : !live ? (
                <p className="mt-3 font-medium">Live payments are OFF, so nothing can be signed or paid. Switch them on in Payment controls first.</p>
              ) : run.payrollApprovedByYou ? (
                <p className="mt-3 font-medium">You approved this payroll, so a different payment approver has to sign the plan (two people, always).</p>
              ) : (
                <>
                  {run.runSignals.length > 0 && <p className="mt-3 text-sm">Run-level flags: {run.runSignals.map((s) => s.replaceAll("_", " ").toLowerCase()).join(", ")}.</p>}
                  {active?.status === "PROPOSED" && (
                    <>
                      <p className="mt-3 text-muted-foreground">
                        Plan {active.planHash.slice(0, 12)}…: {active.count} payments, {active.total} USDC. Flags beside a payment mean the plan needs your eyes; they never pay or block on their own.
                      </p>
                      <SignForm batchId={active.id} total={active.total} count={active.count} held={active.held} />
                    </>
                  )}
                  {(active?.status === "AUTHORIZED" || active?.status === "OPEN") && (
                    <>
                      <p className="mt-3 text-muted-foreground">
                        Signed plan {active.planHash.slice(0, 12)}… ({active.total} USDC) is {active.status === "OPEN" ? "open on the guard contract" : "signed but not yet open on the guard contract"}.
                      </p>
                      <PayControls batchId={active.id} status={active.status} />
                    </>
                  )}
                  {(!active || active.status === "PROPOSED") && unpaid.length > 0 && <PlanForm runId={run.id} rows={unpaid} hasProposal={active?.status === "PROPOSED"} />}
                  {!active && unpaid.length === 0 && <p className="mt-3 text-muted-foreground">Every payment in this run has been paid or stopped.</p>}
                </>
              )}
            </section>
          )}
        </>
      )}
      </div>
      <aside className="min-w-0 space-y-6" aria-label="Payment controls">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-2 text-lg">Live payments</h2>
          <StatusPill status={live ? "ON" : "OFF"} />
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Guard contract</dt>
            <dd className="break-all font-mono text-xs">{company.guard_address ?? "not deployed yet"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Approver wallet</dt>
            <dd className="break-all font-mono text-xs">{view.approver ?? "not created yet"}</dd>
          </div>
          {view.balance !== null && (
            <div>
              <dt className="text-muted-foreground">Approver wallet balance</dt>
              <dd>{view.balance} USDC</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Per-payment ceiling</dt>
            <dd>{company.per_payment_ceiling} USDC</dd>
          </div>
        </dl>
        {company.is_demo || company.is_sandbox ? (
          <p className="mt-4">This is a demo company: it runs in simulation only and never pays.</p>
        ) : (
          <LivePaymentsPanel liveStatus={company.live_status} enabled={live} isOwner={owner} canSwitchOff={owner || canPay} />
        )}
      </section>

      {live && (owner || canPay) && !company.is_demo && !company.is_sandbox && (
        <section className={card}>
          <h2 className="text-lg">Top up the approver wallet</h2>
          <TopUpPanel />
        </section>
      )}

      {canPay && !company.is_demo && !company.is_sandbox && (
        <section className={card}>
          <h2 className="text-lg">Standing payment authorizations</h2>
          <StandingAuthorizationsPanel canCreate={live} initialRows={standing} />
        </section>
      )}
      </aside>
      </div>
    </>
  );
}
