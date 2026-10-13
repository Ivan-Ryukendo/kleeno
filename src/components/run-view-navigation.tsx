import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { runViews, type RunViewId } from "@/components/shell/nav-config";

const segment = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-chip px-2.5 text-[0.8125rem] font-medium sm:min-h-0 sm:h-6.5 [&_svg]:size-4 [&_svg]:shrink-0";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Run tabs beside the run title (mockups/payroll-table.html `.seg`): Table · Workflow · Payments · Activity as a segmented
 * control of plain links. Payments keeps its gate (never in SIMULATION, payment approvers only); when it is closed it shows
 * why and links nowhere. "Needs review" opens this run's exceptions for the payroll roles that resolve them.
 */
export function RunViewNavigation({ runId, current, mode, canPay, canReview = false }: { runId: string; current: RunViewId | null; mode: string; canPay: boolean; canReview?: boolean }) {
  return (
    <>
      <nav aria-label="Run views" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-field border border-border bg-background p-0.5 [scrollbar-width:none]">
        {runViews(runId, mode, canPay).map(({ id, label, href, icon: Icon, reason }) =>
          href ? (
            <Link key={id} href={href} aria-current={current === id ? "page" : undefined} className={`${segment} ${focus} transition-colors duration-150 ${current === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              <Icon aria-hidden="true" />
              {label}
            </Link>
          ) : (
            <span key={id} aria-disabled="true" title={reason} className={`${segment} cursor-not-allowed text-muted-foreground/60`}>
              <Icon aria-hidden="true" />
              {label}
              <span className="sr-only">: {reason}</span>
            </span>
          ),
        )}
      </nav>
      {canReview && (
        <Link href={`/exceptions?${new URLSearchParams({ run: runId })}`} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-field border border-border px-3 text-[0.8125rem] font-medium hover:bg-accent sm:min-h-0 sm:h-7.5 ${focus} [&_svg]:size-4`}>
          <TriangleAlert aria-hidden="true" className="text-signal" />
          Needs review
        </Link>
      )}
    </>
  );
}
