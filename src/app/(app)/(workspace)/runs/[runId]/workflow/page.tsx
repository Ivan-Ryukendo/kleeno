import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { RunWorkflowView } from "@/components/run-workflow-view";
import { RunViewNavigation } from "@/components/run-view-navigation";
import { isPaymentRole, isPayrollRole } from "@/core/tenancy";
import { payrollSide } from "@/components/shell/nav-config";
import { pageSession } from "@/server/auth/page-session";
import { runView, periodView, periodSteps } from "@/server/db/views";
import { reviewReadiness } from "@/server/db/review-readiness";
import { loadPayrollReview } from "@/server/db/payroll-review";
import { uuid } from "@/server/schemas";

function Unavailable({ runId }: { runId: string }) {
  return <><PageHeader title="Run workflow unavailable" description="Recorded run facts could not be loaded. No counts or completion states are inferred." /><Link className="mt-5 inline-flex min-h-11 items-center underline underline-offset-4" href={`/runs/${runId}`}>Back to run</Link></>;
}

export default async function RunWorkflowPage({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { actor, client } = await pageSession();
  const { runId } = await params;
  if (!uuid.safeParse(runId).success) notFound();
  let view: Awaited<ReturnType<typeof runView>>;
  try { view = await runView(client, actor.companyId, runId, actor.roles); } catch { return <Unavailable runId={runId} />; }
  if (!view) notFound();
  const companyRead = await client.from("companies").select("name,live_payments_enabled").eq("id", actor.companyId).maybeSingle();
  if (companyRead.error || !companyRead.data) return <Unavailable runId={runId} />;
  let facts: Awaited<ReturnType<typeof periodView>>;
  try { facts = await periodView(client, actor, runId); } catch { return <Unavailable runId={runId} />; }
  if (!facts) notFound();
  let review = null;
  if (view.financial) {
    try {
      const [readiness, handoff] = await Promise.all([reviewReadiness(client, actor.companyId, runId), loadPayrollReview(client, actor.companyId, runId)]);
      review = { readiness: readiness.readiness, view: handoff };
    } catch { /* Unavailable private evidence never becomes a ready/completed handoff. */ }
  }
  const { run } = view;
  return <><PageHeader title="Run workflow" description="Follow the recorded stages and inspect their evidence." actions={<RunViewNavigation runId={run.id} current="workflow" mode={run.mode} canPay={isPaymentRole(actor.roles)} canReview={payrollSide(actor.roles)} />} /><RunWorkflowView data={{ company: { id: actor.companyId, name: companyRead.data.name }, run: { id: run.id, mode: run.mode, status: run.status, periodStart: run.period_start, periodEnd: run.period_end, configVersion: run.config_version }, steps: periodSteps(run.status, run.mode, facts.openExceptions, companyRead.data.live_payments_enabled), facts, financial: view.financial, canPayroll: isPayrollRole(actor.roles), canPay: isPaymentRole(actor.roles), calculationHash: view.financial ? view.calculationHash : null, review }} /></>;
}
