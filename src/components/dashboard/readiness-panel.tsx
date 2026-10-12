import Link from "next/link";
import type { ReactNode } from "react";
import { Check, CalendarDays, Clock, FileText, Lock, SquareCheck, TriangleAlert } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { zoneDisplaySafe } from "@/lib/timezone-display";
import type { ReadinessStep, StepState } from "@/lib/dashboard-model";
import { cn } from "@/lib/utils";
import { Chip, LinkButton, Panel } from "./ui";

export interface BlockerCard {
  key: string;
  /** Worker code (W004), never a name: names stay locked in the browser. */
  code: string | null;
  tag: string;
  tone: "risk" | "plain";
  text: string;
  href: string;
  action: string;
}

export interface ReadinessFacts {
  /** undefined: not visible to this role; null: not configured. */
  cutoff?: { at: string; zone: string; daysText: string | null } | null;
  payDate: string | null;
  matched: { count: number; total: number } | null;
  /** undefined: not visible to this role; null: expected inputs are not configured. */
  inputs?: { received: number; expected: number } | null;
}

export type ReadinessMode = "blocked" | "ready" | "progress";

const dot: Record<StepState, string> = {
  done: "border-success bg-success text-white",
  current: "border-primary bg-background text-foreground",
  blocked: "border-signal bg-signal/10 text-signal",
  pending: "border-border bg-background text-muted-foreground",
  unavailable: "border-dashed border-border bg-background text-muted-foreground",
};
const stateWord: Record<StepState, string> = { done: "Done.", current: "Current step.", blocked: "Blocked.", pending: "Not started.", unavailable: "Not used in this run." };

function Stepper({ steps, runLabel }: { steps: ReadinessStep[]; runLabel: string }) {
  return (
    <ol aria-label={`${runLabel} progress`} className="m-0 grid list-none grid-cols-1 gap-0 p-0 sm:grid-cols-4 sm:gap-y-3.5 xl:grid-cols-7">
      {steps.map((s, i) => {
        const body = (
          <>
            <span className={cn("relative flex size-6 items-center justify-center rounded-full border-2 text-[0.6875rem] font-semibold max-sm:row-span-2 sm:mb-1.5", dot[s.state])}>
              {s.state === "done" ? <Check aria-hidden className="size-3" strokeWidth={3} /> : s.state === "unavailable" ? <Lock aria-hidden className="size-3" /> : i + 1}
            </span>
            <b className="text-[0.8125rem] font-medium text-foreground">{s.label}</b>
            <span className={cn("text-xs", s.state === "blocked" && "font-medium text-signal")}>{s.detail}</span>
            <span className="sr-only">{stateWord[s.state]}</span>
          </>
        );
        return (
          <li key={s.id} aria-current={s.state === "current" || s.state === "blocked" ? "step" : undefined} className={cn(
            "relative grid min-w-0 gap-0.5 pr-2 text-xs text-muted-foreground",
            "before:absolute before:top-[11px] before:right-1 before:left-7 before:h-0.5 before:bg-border before:content-['']",
            "last:before:hidden sm:max-xl:nth-4:before:hidden",
            "max-sm:grid-cols-[24px_1fr] max-sm:gap-x-2.5 max-sm:pr-0 max-sm:pb-3 max-sm:before:top-6 max-sm:before:right-auto max-sm:before:bottom-0 max-sm:before:left-[11px] max-sm:before:h-auto max-sm:before:w-0.5",
            s.state === "done" && "before:bg-success",
          )}>
            {s.href && s.state !== "unavailable"
              ? <Link href={s.href} className="contents focus-visible:outline-none [&:focus-visible>b]:underline"><span className="contents">{body}</span></Link>
              : <span className="contents">{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ icon, label, children, note }: { icon: ReactNode; label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</dt>
      <dd className="m-0 font-medium tabular-nums">{children}{note && <small className="block text-xs font-[450] text-muted-foreground">{note}</small>}</dd>
    </div>
  );
}

export function ReadinessPanel({ mode, runLabel, title, blockerCount, checkedAt, timeZone, steps, blockers, moreBlockers, runHref, facts, handoff, workerNote }: {
  mode: ReadinessMode;
  runLabel: string;
  title: string;
  blockerCount: number | null;
  checkedAt: string;
  timeZone: string;
  steps: ReadinessStep[];
  blockers: BlockerCard[];
  /** Open exceptions that are not listed as cards (the list is capped). */
  moreBlockers: number;
  runHref: string;
  facts: ReadinessFacts;
  handoff?: ReactNode;
  workerNote: boolean;
}) {
  const icon = mode === "blocked" ? <TriangleAlert aria-hidden className="size-4 text-signal" /> : <Check aria-hidden className="size-4 text-success" />;
  const chip = mode === "blocked" && blockerCount !== null ? <Chip tone="risk">{blockerCount} blocker{blockerCount === 1 ? "" : "s"}</Chip> : mode === "ready" ? <Chip tone="ok">No blockers</Chip> : null;
  const { cutoff, inputs, matched, payDate } = facts;
  return (
    <Panel id="ready-h" title={title} icon={icon} chip={chip} aside={mode === "progress" ? undefined : <>Checked <LocalTime at={checkedAt} timeZone={timeZone} /></>} className="mt-5">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0 p-4">
          <Stepper steps={steps} runLabel={runLabel} />
          {mode !== "progress" && <>
            <h3 className="mt-[18px] mb-2 text-xs font-medium text-muted-foreground">What blocks approval</h3>
            {blockers.length === 0 && moreBlockers === 0
              ? <p className="rounded-card border px-3.5 py-3 text-sm text-muted-foreground">{mode === "ready" ? "Nothing is blocking approval for this run." : "No blocker is recorded."}</p>
              : <ul className="m-0 list-none divide-y rounded-card border p-0">
                {blockers.map((b) => (
                  <li key={b.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                        {b.code && <span className="font-mono text-xs">{b.code}</span>}
                        <Chip tone={b.tone}>{b.tag}</Chip>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{b.text}</p>
                    </div>
                    <LinkButton href={b.href}>{b.action}</LinkButton>
                  </li>
                ))}
                {moreBlockers > 0 && <li className="px-3.5 py-3 text-sm"><Link href={runHref} className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">{moreBlockers} more open exception{moreBlockers === 1 ? "" : "s"}</Link></li>}
              </ul>}
            {workerNote && <p className="mt-2 text-xs text-muted-foreground">Workers are shown by code. Names stay in your browser; unlock them on <Link href="/workers" className="underline underline-offset-4">All Workers</Link>.</p>}
          </>}
          {handoff}
        </div>
        <aside aria-label="Key dates and inputs" className="grid content-start gap-3.5 border-t p-4 max-lg:grid-cols-2 max-sm:grid-cols-1 lg:border-t-0 lg:border-l">
          <dl className="m-0 grid gap-3">
            {cutoff !== undefined && (cutoff
              ? <Fact icon={<Clock aria-hidden className="size-3.5" />} label="Approval cutoff" note={cutoff.daysText}><LocalTime at={cutoff.at} timeZone={timeZone} /><span className="block text-xs font-[450] text-muted-foreground">set for {zoneDisplaySafe(cutoff.zone, cutoff.at)}</span></Fact>
              : <Fact icon={<Clock aria-hidden className="size-3.5" />} label="Approval cutoff" note="Data required: company cutoff must be configured.">Not set</Fact>)}
            {payDate && <Fact icon={<CalendarDays aria-hidden className="size-3.5" />} label="Pay date" note="From the company pay schedule (UTC)">{new Date(`${payDate}T00:00:00Z`).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</Fact>}
          </dl>
          <dl className="m-0 grid gap-3">
            <Fact icon={<SquareCheck aria-hidden className="size-3.5" />} label="Matched automatically" note={matched ? undefined : "Available after the imported records are reconciled"}>
              {matched ? <>{matched.count} of {matched.total} records
                <span role="img" aria-label={`${matched.count} of ${matched.total} matched`} className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-accent"><i className="block h-full rounded-full bg-success" style={{ width: `${matched.total ? (matched.count / matched.total) * 100 : 0}%` }} /></span></> : "Not available yet"}
            </Fact>
            {inputs !== undefined && (inputs
              ? <Fact icon={<FileText aria-hidden className="size-3.5" />} label="Inputs received" note="Names are anonymised in your browser before import">{inputs.received} of {inputs.expected} required inputs</Fact>
              : <Fact icon={<FileText aria-hidden className="size-3.5" />} label="Inputs received" note="Data required: expected inputs must be configured.">Not set</Fact>)}
          </dl>
        </aside>
      </div>
    </Panel>
  );
}
