import Link from "next/link";
import { GitBranch, History, Table2, Wallet } from "lucide-react";

export function RunViewNavigation({ runId, current, mode, canPay }: { runId: string; current: "table" | "workflow"; mode: string; canPay: boolean }) {
  const root = `/runs/${encodeURIComponent(runId)}`;
  const views = [
    { id: "table", label: "Table", href: root, icon: Table2 },
    { id: "workflow", label: "Workflow", href: `${root}/workflow`, icon: GitBranch },
    ...(mode !== "SIMULATION" && canPay ? [{ id: "payments", label: "Payments", href: `/settlement?${new URLSearchParams({ run: runId })}`, icon: Wallet }] : []),
    { id: "activity", label: "Activity", href: `/audit?${new URLSearchParams({ run: runId })}`, icon: History },
  ];
  return <nav aria-label="Run views" className="mt-4 flex min-w-0 flex-wrap gap-x-2 gap-y-1 border-b border-border">
    {views.map(({ id, label, href, icon: Icon }) => <Link key={id} href={href} aria-current={current === id ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${current === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"}`}><Icon className="size-4 shrink-0" aria-hidden="true" />{label}</Link>)}
  </nav>;
}
