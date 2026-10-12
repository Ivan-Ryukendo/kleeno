import Link from "next/link";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Chip } from "@/components/dashboard/ui";
import { RunViewNavigation } from "@/components/run-view-navigation";
import { StatusPill } from "@/components/status-pill";
import { periodLabel, type RunViewId } from "@/components/shell/nav-config";
import type { FrameData } from "./frame-data";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface RunFrameProps {
  run: { id: string; mode: string; status: string; periodStart: string; periodEnd: string };
  /** Which run tab is current; null for the Needs review sub-view, which belongs to no tab. */
  current: RunViewId | null;
  data: FrameData;
  /** Roles: payroll side may open Needs review and the approval step; payment approvers get the Payments tab. */
  canPayroll: boolean;
  canPay: boolean;
  /** Same screen for another run (a tab keeps its place when the period changes). */
  hrefFor: (runId: string) => string;
  /** Short read-only hint at the end of the summary line. */
  hint: string;
}

/** Approval is reachable only where it exists: live runs, payroll roles, after validation. Everything else says why not. */
function approval({ run, canPayroll, data }: Pick<RunFrameProps, "run" | "canPayroll" | "data">) {
  if (!canPayroll || run.mode === "SIMULATION") return null;
  if (run.status === "CALCULATION_VALIDATED" || run.status === "PENDING_APPROVAL") return { href: `/runs/${run.id}#next-step`, reason: null };
  if (["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING", "READY_FOR_CALCULATION", "CALCULATED"].includes(run.status)) {
    return { href: null, reason: data.facts.openExceptions ? "Approval opens when exceptions are closed" : "Approval opens after the calculation is validated" };
  }
  return null;
}

/**
 * The Payroll frame shared by Table, Needs review and Workflow (mockups/payroll-*.html): title, period menu, run tabs, one
 * primary action and the summary line. It only reads; every action stays on the page that already owned it.
 */
export function RunFrame({ run, current, data, canPayroll, canPay, hrefFor, hint }: RunFrameProps) {
  const { facts, runs } = data;
  const label = periodLabel(`${run.periodStart} to ${run.periodEnd}`);
  const menu = runs.some((r) => r.id === run.id) ? runs : [{ id: run.id, label, status: run.status }, ...runs];
  const action = approval({ run, canPayroll, data });
  const open = facts.openExceptions;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <h1 className="text-2xl font-medium tracking-tight">Payroll</h1>
        <details className="group relative">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-field border border-border bg-background px-3 text-[0.8125rem] font-medium hover:bg-accent sm:min-h-0 sm:h-8 ${focus} [&::-webkit-details-marker]:hidden [&_svg]:size-4`}>
            <CalendarDays aria-hidden="true" className="text-muted-foreground" />
            <span>{label}</span>
            <ChevronDown aria-hidden="true" className="text-muted-foreground group-open:rotate-180" />
            <span className="sr-only">: choose a pay run</span>
          </summary>
          <ul aria-label="Pay runs" className="absolute left-0 z-20 mt-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-card border bg-popover p-1 shadow-md">
            {menu.map((r) => (
              <li key={r.id}>
                <Link href={hrefFor(r.id)} aria-current={r.id === run.id ? "true" : undefined} className={`flex min-h-11 items-center justify-between gap-2 rounded-field px-2.5 text-[0.8125rem] hover:bg-accent sm:min-h-9 ${r.id === run.id ? "bg-accent font-medium" : ""} ${focus}`}>
                  <span>{r.label}</span>
                  <span className="text-xs text-muted-foreground">{r.status.replaceAll("_", " ").toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
        <RunViewNavigation runId={run.id} current={current} mode={run.mode} canPay={canPay} />
        {action && (
          <span className="sm:ml-auto">
            {action.href ? (
              <Link href={action.href} className={`inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[0.8125rem] font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-0 sm:h-8 ${focus}`}>Review and approve</Link>
            ) : (
              <span aria-disabled="true" title={action.reason ?? undefined} className="inline-flex min-h-11 cursor-not-allowed items-center rounded-field border border-border px-4 text-[0.8125rem] font-medium text-muted-foreground sm:min-h-0 sm:h-8">Review and approve<span className="sr-only">: {action.reason}</span></span>
            )}
          </span>
        )}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-muted-foreground">
        <StatusPill status={run.status} />
        {facts.workers !== null && <span><b className="font-medium text-foreground tabular-nums">{facts.workers}</b> {facts.workers === 1 ? "worker" : "workers"}</span>}
        {facts.autoMatched && <span><b className="font-medium text-foreground tabular-nums">{facts.autoMatched.count}</b> of {facts.autoMatched.total} records matched automatically</span>}
        {canPayroll && (
          <Link href={`/exceptions?${new URLSearchParams({ run: run.id })}`} className={`inline-flex min-h-11 items-center underline-offset-4 hover:underline sm:min-h-0 ${open ? "font-medium text-signal" : ""} ${focus}`}>
            {open ? `${open} needs review` : "Needs review"}
          </Link>
        )}
        {!canPayroll && open !== null && open > 0 && <Chip tone="risk">{open} open</Chip>}
        <span>{hint}</span>
      </p>
    </div>
  );
}
