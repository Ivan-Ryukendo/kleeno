"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/status-pill";
import type { workerHistoryView } from "@/server/db/views";

type History = NonNullable<Awaited<ReturnType<typeof workerHistoryView>>>;
export function WorkerHistoryPanel({ history }: { history: History }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  return <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (!value) router.replace("/workers", { scroll: false }); }}>
    <SheetContent className="w-full max-w-full overflow-y-auto motion-reduce:transition-none sm:w-[34rem] sm:max-w-[34rem]">
      <SheetHeader><SheetTitle>{history.code} · History</SheetTitle><SheetDescription>Recorded payroll, compensation, exceptions and settlement evidence.</SheetDescription></SheetHeader>
      <div className="space-y-6 px-4 pb-6">
        {history.truncated && <p className="rounded-field border p-3 text-xs text-muted-foreground">Showing the latest 20 records in each section. Open a run for its full evidence.</p>}
        <section><h3 className="font-medium">Past runs</h3>{!history.runs.length ? <p className="mt-2 text-muted-foreground">No recorded runs for this worker.</p> : <ul className="mt-2 divide-y">{history.runs.map((r) => <li key={r.id} className="space-y-2 py-3"><Link className="inline-flex min-h-8 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/runs/${r.id}#calculation-trace`}>{r.period_start} to {r.period_end}</Link><div className="flex flex-wrap items-center gap-2"><StatusPill status={r.mode} /><StatusPill status={r.status} />{r.net !== null && <span className="tabular-nums">Net {r.net} USDC</span>}</div></li>)}</ul>}</section>
        <section><h3 className="font-medium">Pay changes</h3>{!history.changes.length ? <p className="mt-2 text-muted-foreground">No pay changes available for your role.</p> : <ol className="mt-2 divide-y">{history.changes.map((c) => <li key={c.version} className="py-3"><p>Version {c.version} · {c.reason.replaceAll("_", " ").toLowerCase()}</p><p className="mt-1 tabular-nums">Per period {c.base} USDC · Hourly {c.hourly} USDC</p><time className="text-xs text-muted-foreground" dateTime={c.at}>{new Date(c.at).toLocaleDateString("en", { timeZone: "UTC" })}</time></li>)}</ol>}</section>
        <section><h3 className="font-medium">Exceptions</h3>{!history.exceptions.length ? <p className="mt-2 text-muted-foreground">No recorded exceptions.</p> : <ul className="mt-2 divide-y">{history.exceptions.map((e) => <li key={e.id} className="space-y-2 py-3"><Link className="inline-flex min-h-8 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/exceptions?run=${e.run_id}`}>{e.category.replaceAll("_", " ").toLowerCase()}</Link><div><StatusPill status={e.status} /></div></li>)}</ul>}</section>
        <section><h3 className="font-medium">Payments</h3>{!history.payments.length ? <p className="mt-2 text-muted-foreground">No payment obligations. Simulation creates none.</p> : <ul className="mt-2 divide-y">{history.payments.map((p) => <li key={p.id} className="space-y-2 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><StatusPill status={p.status} />{p.amount !== null && <span className="tabular-nums">{p.amount} USDC</span>}</div><Link className="inline-flex min-h-8 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/settlement?run=${p.runId}`}>Open payment evidence</Link>{p.txUrl && <a className="ml-4 inline-flex min-h-8 items-center rounded-field underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Verified transaction, opens in a new tab" target="_blank" rel="noopener noreferrer" href={p.txUrl}>Verified transaction</a>}</li>)}</ul>}</section>
      </div>
    </SheetContent>
  </Sheet>;
}
