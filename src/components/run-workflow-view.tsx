import Link from "next/link";
import type { ReactNode } from "react";
import { Check, GitBranch, ListOrdered } from "lucide-react";
import { Panel } from "@/components/dashboard/ui";
import { WorkflowStepper } from "@/components/payroll/workflow-stepper";
import { StatusPill } from "@/components/status-pill";
import type { PeriodStep } from "@/server/db/views";
import type { ReadinessResult } from "@/core/workflow/readiness";
import type { ReviewView } from "@/core/workflow/review";

export interface RunWorkflowData {
  company: { id: string; name: string };
  run: { id: string; mode: string; status: string; periodStart: string; periodEnd: string; configVersion: number };
  steps: PeriodStep[];
  financial: boolean; canPayroll: boolean; canPay: boolean;
  facts: { workers: number | null; autoMatched: { count: number; total: number } | null; openExceptions: number; settled: number | null; obligations: number | null };
  calculationHash: string | null;
  review: { readiness: ReadinessResult; view: ReviewView } | null;
}
type Node = { title: string; state: PeriodStep["state"]; summary: string; detail: ReactNode };
const stateLabels = { done: "Done", current: "Current", blocked: "Blocked", pending: "Not started", unavailable: "Not available" };
const linkClass = "inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";
const ref = (label: string, value: string | number) => <p className="mt-2 text-sm break-all"><span className="text-muted-foreground">{label}: </span><code>{value}</code></p>;

function WorkflowNodes({ nodes, label }: { nodes: Node[]; label: string }) {
  return <ol aria-label={label} className="relative ml-2 mt-5 space-y-4 border-l border-border pl-6">
    {nodes.map((node, index) => <li key={node.title} aria-current={node.state === "current" ? "step" : undefined} className="relative min-w-0">
      <span aria-hidden="true" className={`absolute -left-9.5 top-3.5 grid size-6 place-items-center rounded-full border text-xs ${node.state === "done" ? "border-success bg-success text-white" : node.state === "blocked" ? "border-signal bg-background text-signal" : node.state === "current" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>{node.state === "done" ? <Check className="size-3.5" /> : index + 1}</span>
      <details className={`min-w-0 rounded-card border ${node.state === "blocked" ? "border-signal/40" : "border-border"}`}>
        <summary className="min-h-11 cursor-pointer rounded-card p-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <span className="font-medium">{index + 1}. {node.title}</span>
          <span className={`ml-3 inline-block rounded-chip border px-2 py-0.5 text-xs ${node.state === "blocked" ? "text-signal border-signal/40" : node.state === "done" ? "border-transparent bg-success-soft text-success" : "text-muted-foreground border-border"}`}>{stateLabels[node.state]}</span>
          <span className="mt-1.5 block break-words text-sm text-muted-foreground">{node.summary}</span>
        </summary>
        <div className="min-w-0 border-t border-border p-4 text-sm">{node.detail}</div>
      </details>
    </li>)}
  </ol>;
}

/** A read-only graph of recorded facts; disclosures and links never execute a workflow transition. */
export function RunWorkflowView({ data }: { data: RunWorkflowData }) {
  const { run, facts, review } = data;
  const root = `/runs/${run.id}`;
  const stageDetails: ReactNode[] = [
    <div key="policy">{ref("Pinned policy version", run.configVersion)}<p className="mt-2">The run keeps its approved policy version. Current company settings do not rewrite this run.</p>{data.canPayroll && <Link className={linkClass} href="/configuration">Open company pay policy</Link>}</div>,
    <div key="import"><p>{facts.workers === null ? "Worker coverage is unavailable; it is not zero." : `${facts.workers} distinct workers in recorded run inputs or results.`}</p><p className="mt-2">{facts.autoMatched === null ? "Reconciled import counts are unavailable." : `${facts.autoMatched.count} of ${facts.autoMatched.total} imported records are not flagged by reconciliation.`}</p>{data.canPayroll && <Link className={linkClass} href={`/import?run=${run.id}`}>Inspect imports</Link>}</div>,
    <div key="exceptions"><p>{facts.openExceptions} open, in-review or escalated exceptions. A task marked resolved does not resolve its source exception.</p>{data.canPayroll && <div className="flex flex-wrap gap-x-5"><Link className={linkClass} href={`/exceptions?run=${run.id}`}>Inspect exceptions</Link><Link className={linkClass} href={`${root}#review-tasks-heading`}>Inspect owned review tasks</Link></div>}</div>,
    <div key="calculation">{!data.financial ? <p>Your role cannot inspect calculation amounts or private review evidence.</p> : !data.calculationHash ? <p>No immutable calculation is recorded yet.</p> : <>{ref("Immutable calculation hash", data.calculationHash)}<Link className={linkClass} href={`${root}#calculation-trace`}>Inspect calculation sources and traces</Link></>}</div>,
    <div key="approval"><p>{run.mode === "SIMULATION" ? "Simulation stops at validated calculation; payroll approval and payment authority are unavailable." : "Payroll approval is a separate human decision bound to the calculation hash. Review sign-off does not approve payroll."}</p>{run.mode !== "SIMULATION" && data.canPayroll && <Link className={linkClass} href={root}>Inspect payroll approval state</Link>}</div>,
    <div key="settlement"><p>{run.mode === "SIMULATION" ? "Simulation cannot create obligations or pay." : facts.settled === null || facts.obligations === null ? "Verified settlement counts are unavailable; they are not zero." : `${facts.settled} of ${facts.obligations} obligations have independently verified settlement.`}</p><p className="mt-2">A CSV export or manual acknowledgement is never settlement evidence.</p>{run.mode !== "SIMULATION" && data.canPay && <Link className={linkClass} href={`/settlement?run=${run.id}`}>Inspect payments and receipts</Link>}</div>,
  ];
  const payrollNodes: Node[] = data.steps.map((step, index) => ({ title: step.label, state: step.state, summary: step.detail || stateLabels[step.state], detail: stageDetails[index] }));
  const reviewNodes: Node[] = review ? [
    { title: "Review readiness", state: review.readiness.ready ? "done" : "blocked", summary: `${review.readiness.received} of ${review.readiness.expected} configured datasets received`, detail: <><p>Dataset completeness does not imply all-worker coverage.</p>{review.readiness.cutoff ? <>{ref("Cutoff", review.readiness.cutoff.at)}{ref("Company timezone", review.readiness.cutoff.timeZone)}</> : <p className="mt-2">Company cutoff and timezone require configuration.</p>}{review.readiness.blockers.length > 0 && <ul className="mt-3 list-disc pl-5">{review.readiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}<ul className="mt-3 space-y-2">{review.readiness.items.map(item => <li key={item.id}>{item.label}: {item.status.replaceAll("_", " ")}{item.ref && ref("Evidence reference", item.ref)}{item.reason && <p className="text-muted-foreground">{item.reason}</p>}</li>)}</ul><Link className={linkClass} href={`${root}#readiness-heading`}>Inspect review readiness</Link></> },
    { title: "Human review sign-off", state: review.view.signoff ? "done" : review.readiness.ready ? "current" : "pending", summary: review.view.signoff ? "Separate review sign-off recorded" : "No review sign-off recorded", detail: <><p>This sign-off creates no payroll approval, obligation or payment authority.</p>{review.view.signoff && <>{ref("Sign-off reference", review.view.signoff.id)}{ref("Reviewer ID", review.view.signoff.actor)}{ref("Recorded at", review.view.signoff.at)}</>}<Link className={linkClass} href={`${root}#review-heading`}>Inspect review and handoff</Link></> },
    { title: "Versioned export", state: review.view.export ? "done" : review.view.signoff ? "current" : "pending", summary: review.view.export ? `CSV version ${review.view.export.formatVersion} generated` : "No export manifest recorded", detail: <><p>Generated bytes do not prove delivery or provider acceptance.</p>{review.view.export && <>{ref("Export reference", review.view.export.id)}{ref("CSV byte hash", review.view.export.byteHash)}{ref("Generated at", review.view.export.at)}<Link className={linkClass} href={`/api/runs/${run.id}/review?download=1`}>Download recorded CSV</Link></>}</> },
    { title: "Manual handoff acknowledgement", state: review.view.acknowledgement?.status === "MANUAL_ACCEPTED" ? "done" : review.view.acknowledgement ? "blocked" : "pending", summary: review.view.acknowledgement?.status === "MANUAL_ACCEPTED" ? "Manually acknowledged as accepted" : review.view.acknowledgement?.status === "MANUAL_REJECTED" ? "Manual acknowledgement rejected; still needs review" : review.view.acknowledgement?.status === "UNKNOWN" ? "Manual outcome unknown; still needs review" : "No manual acknowledgement recorded", detail: <><p>Owner-supplied evidence is a manual report, not independently verified payment settlement.</p>{review.view.acknowledgement && <>{ref("Supplied reference", review.view.acknowledgement.reference)}{ref("Recorded at", review.view.acknowledgement.at)}</>}<Link className={linkClass} href={`${root}#review-heading`}>Inspect handoff evidence</Link></> },
  ] : [];
  const count = (state: PeriodStep["state"]) => data.steps.filter((x) => x.state === state).length;
  const done = count("done");
  const rest = [[count("current"), "current"], [count("blocked"), "blocked"], [count("pending"), "not started"], [count("unavailable"), run.mode === "SIMULATION" ? "not available in SIMULATION" : "not available"]].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`);
  const cards = payrollNodes.map((n) => ({ title: n.title, state: n.state, summary: n.summary, label: stateLabels[n.state], detail: n.detail }));
  return <div className="min-w-0">
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem]">
      <span className="font-medium">{done} of {data.steps.length} steps done</span>
      <span role="img" aria-label={`${done} of ${data.steps.length} steps done`} className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-primary" style={{ width: `${data.steps.length ? Math.round((done / data.steps.length) * 100) : 0}%` }} /></span>
      <span className="text-muted-foreground">{rest.join(" · ")}</span>
    </div>
    <Panel id="run-steps-heading" className="mt-4 hidden md:block" icon={<GitBranch aria-hidden="true" className="size-4 text-muted-foreground" />} title="Run steps" aside="Select a step to inspect it. Nothing here runs or changes payroll."><WorkflowStepper steps={cards} /></Panel>
    <Panel id="payroll-workflow-heading" className="mt-4" icon={<ListOrdered aria-hidden="true" className="size-4 text-muted-foreground" />} title="Payroll workflow" aside="Same steps as text">
      <div className="px-4 pb-4"><p className="mt-3 text-sm text-muted-foreground">Inspect each recorded stage. This view cannot approve, change or execute the run.</p><WorkflowNodes nodes={payrollNodes} label="Recorded payroll workflow steps" /></div>
    </Panel>
    <Panel id="review-workflow-heading" className="mt-4" title="Review-only handoff" aside="Grants no payroll or payment authority">
      <div className="px-4 pb-4">{!data.financial ? <p className="mt-4 rounded-card border p-4">Your role cannot inspect private review evidence.</p> : !review ? <p role="status" className="mt-4 rounded-card border p-4">Review evidence unavailable. Readiness, sign-off and handoff facts could not be loaded; no completion is inferred.</p> : <WorkflowNodes nodes={reviewNodes} label="Recorded review and handoff steps" />}</div>
    </Panel>
    <div className="mt-4 min-w-0 rounded-card border border-border p-4 text-sm">
      <p className="font-medium break-words">{data.company.name}</p>{ref("Company ID", data.company.id)}<p className="mt-2">Period {run.periodStart} to {run.periodEnd}</p>{ref("Run ID", run.id)}
      <div className="mt-3 flex flex-wrap gap-2"><StatusPill status={run.mode} /><StatusPill status={run.status} /></div>
    </div>
    <p className="mt-4 text-xs text-muted-foreground">Projected from recorded run state. There is no workflow editor: steps advance only through their own approvals.</p>
  </div>;
}
