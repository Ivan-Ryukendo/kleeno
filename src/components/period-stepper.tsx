import Link from "next/link";
import { Check, Circle, LockKeyhole } from "lucide-react";
import type { PeriodStep } from "@/server/db/views";

export function PeriodStepper({ steps, runId, canPayroll, canPay }: { steps: PeriodStep[]; runId: string; canPayroll: boolean; canPay: boolean }) {
  const hrefs = [canPayroll ? "/configuration" : null, canPayroll ? `/import?run=${runId}` : null, canPayroll ? `/exceptions?run=${runId}` : null, `/runs/${runId}`, `/runs/${runId}`, canPay ? `/settlement?run=${runId}` : null];
  return <ol aria-label="Payroll period progress" className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
    {steps.map((step, i) => {
      const Icon = step.state === "done" ? Check : step.state === "blocked" || step.state === "unavailable" ? LockKeyhole : Circle;
      const content = <><span className="flex items-center gap-2 font-medium"><Icon size={16} aria-hidden />{step.label}</span><span className="mt-2 block text-xs text-muted-foreground">{step.detail || ({ done: "Complete", current: "Next step", pending: "Pending", blocked: "Needs review", unavailable: "Unavailable" }[step.state])}</span></>;
      return <li key={step.label} aria-current={step.state === "current" || step.state === "blocked" ? "step" : undefined} className={`rounded-card border p-3 ${step.state === "blocked" ? "border-signal/40 text-signal" : step.state === "current" ? "border-primary bg-secondary" : "border-border"}`}>
        {hrefs[i] && step.state !== "unavailable" ? <Link className="block min-h-11" href={hrefs[i]!}>{content}</Link> : <div>{content}</div>}
      </li>;
    })}
  </ol>;
}
