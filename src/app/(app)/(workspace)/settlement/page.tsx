import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { LivePaymentsPanel, PayControls, PlanForm, ReceiptLinkButton, SignForm, TopUpPanel } from "@/components/settlement-actions";
import { StatusPill } from "@/components/status-pill";
import { isOwner } from "@/core/tenancy";
import { isPaymentRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { settlementView } from "@/server/db/settlement";

export const metadata = { title: "Payments · Kleeno" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const card = "mt-6 panel";
const PLANNABLE = ["OBLIGATIONS_CREATED", "PARTIALLY_SETTLED", "PAYMENT_FAILED"];

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const { run: wanted } = await searchParams;
  const view = await settlementView(client, actor.companyId, actor.userId, wanted && UUID.test(wanted) ? wanted : undefined);
  const { company, run, runs } = view;
  const canPay = isPaymentRole(actor.roles);
  const owner = isOwner(actor.roles);
  const live = company.live_payments_enabled;
  const active = run?.batch && ["PROPOSED", "AUTHORIZED", "OPEN"].includes(run.batch.status) ? run.batch : null;
  const unpaid = run?.obligations.filter((o) => o.status === "CREATED" || o.status === "ON_HOLD") ?? [];
  const settledCount = run?.obligations.filter((o) => o.status === "SETTLED").length ?? 0;
  const link = "underline underline-offset-4";

  return (
    <>
      <PageHeader title="Payments" description="Pay what was approved. Money moves only exactly as it was signed, and you can stop it at any time. Arc testnet USDC, no real funds." />

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

      {!run ? (
        <section className={card}>
          <h2 className="text-lg">Nothing to pay yet</h2>
          <p className="mt-3 text-muted-foreground">
            A live testnet run appears here once it is sent for approval. Start one from the <Link href="/dashboard#start-run" className={link}>Home</Link>.
          </p>
        </section>
      ) : (
        <>
          {runs.length > 1 && (
            <nav aria-label="Runs" className="mt-6 flex flex-wrap gap-2">
              {runs.map((r) => (
                <Link key={r.id} href={`/settlement?run=${r.id}`} className={`rounded-field border px-3 py-1.5 text-sm ${r.id === run.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                  {r.period_start} to {r.period_end}
                </Link>
              ))}
            </nav>
          )}

          <section className={card}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-2 text-lg">Run {run.period}</h2>
              <StatusPill status="LIVE_TESTNET" />
              <StatusPill status={run.status} />
              <Link href={`/runs/${run.id}`} className={`text-sm ${link}`}>
                Review the calculation
              </Link>
            </div>

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
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Worker</th>
                        <th className="py-2 pr-4 text-right font-medium">Amount (USDC)</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 font-medium">Flags</th>
                        <th className="py-2 font-medium">Arc receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.obligations.map((o) => (
                        <tr key={o.id} className="border-t border-border align-top">
                          <td className="py-3 pr-4 font-medium">{o.worker}</td>
                          <td className="py-3 pr-4 text-right">{o.amount}</td>
                          <td className="py-3 pr-4">
                            <StatusPill status={o.status} />
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
                <p className="mt-3 font-medium">Live payments are OFF, so nothing can be signed or paid. Switch them on above first.</p>
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
    </>
  );
}
