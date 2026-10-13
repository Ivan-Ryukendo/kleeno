"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoTable } from "@/components/landing-demo-table";
import { DemoWorkflow, type WorkflowStart } from "@/components/landing-demo-workflow";
import { monthRows, monthSummary, months, usd } from "@/components/landing-demo-data";
import { monthlyPayCard } from "@/components/landing-demo-graph";

// Hero of the landing page: the Payroll page of the product (docs/mockups/payroll-table.html and payroll-workflow.html) that
// visitors can click through. Four tabs, a month picker with past runs, a full table, a workflow graph and a scripted AI box.
// Sample data only (company "Northwind Remote", Arc testnet USDC, SIMULATION); nothing is read from or sent to a server.
// The Table tab is server-rendered; the other tabs mount the first time they are opened and then stay mounted.

type TabId = "table" | "workflow" | "payments" | "activity";
const tabs: { id: TabId; label: string }[] = [
  { id: "table", label: "Table" },
  { id: "workflow", label: "Workflow" },
  { id: "payments", label: "Payments" },
  { id: "activity", label: "Activity" },
];
const hair = "border-foreground/10";
const num = "[font-variant-numeric:tabular-nums]";

export function PayrollDemo() {
  const [tab, setTab] = useState<TabId>("table");
  const [seen, setSeen] = useState<Set<TabId>>(() => new Set<TabId>(["table"]));
  const [monthIdx, setMonthIdx] = useState(0);
  const [flow, setFlow] = useState<{ start?: WorkflowStart; n: number }>({ n: 0 });
  const month = months[monthIdx];
  const s = useMemo(() => monthSummary(monthRows(monthIdx)), [monthIdx]);

  const open = (t: TabId) => {
    setTab(t);
    setSeen((cur) => (cur.has(t) ? cur : new Set(cur).add(t)));
  };
  const seeWorkflow = (code: string) => {
    // Every worker has a person workflow; open it on the card that produces their monthly pay.
    const start: WorkflowStart = { scope: "person", who: code, detail: "detailed", sel: monthlyPayCard(code) };
    setFlow((f) => ({ start, n: f.n + 1 }));
    open("workflow");
  };

  const readyAmount = monthIdx === 0 ? s.total - 7800 - 6390 : s.total;
  const readyCount = monthIdx === 0 ? 12 : s.workers;

  return (
    <figure className="w-full overflow-hidden rounded-[0.5rem] bg-white text-left text-[0.8125rem] leading-5 text-foreground">
      <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5", hair)}>
        <p className="truncate text-muted-foreground">
          Northwind Remote <span aria-hidden>/</span> Payroll <span aria-hidden>/</span> <span className="text-foreground">{month.label}</span>
        </p>
        <span className="rounded-[0.25rem] border border-foreground/15 px-1.5 py-0.5 text-xs font-semibold tracking-[0.02em]">SIMULATION</span>
      </div>

      <div className="px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-xl font-medium tracking-tight sm:text-2xl">Payroll</p>
          <label className={cn("relative inline-flex h-8 items-center rounded-[0.375rem] border font-medium focus-within:ring-3 focus-within:ring-ring/40", hair)}>
            <span className="sr-only">Pay period</span>
            <CalendarDays aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
            <select value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))} className="h-full cursor-pointer appearance-none rounded-[0.375rem] bg-transparent pl-8 pr-8 font-medium outline-none">
              {months.map((m, i) => (
                <option key={m.label} value={i}>{m.label} · Run {m.run}</option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" />
          </label>
        </div>

        <div role="tablist" aria-label="Payroll views" className={cn("mt-3 flex gap-0.5 overflow-x-auto border-b", hair)}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`demo-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`demo-panel-${t.id}`}
              onClick={() => open(t.id)}
              className={cn("-mb-px cursor-pointer whitespace-nowrap border-b-2 px-2.5 py-2 font-medium outline-none transition-colors focus-visible:bg-muted", tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pb-3 text-muted-foreground">
          <span><b className={cn("font-medium text-foreground", num)}>{s.workers}</b> workers</span>
          <span><b className={cn("font-medium text-foreground", num)}>{s.matched}</b> matched automatically</span>
          {s.review > 0 && <span className="font-medium text-signal">{s.review} needs review</span>}
          {s.hold > 0 && <span className="font-medium text-signal">{s.hold} on hold</span>}
          <span className="hidden lg:inline">Click any number to see how it is calculated</span>
        </p>
      </div>

      <div role="tabpanel" id="demo-panel-table" aria-labelledby="demo-tab-table" hidden={tab !== "table"} className={cn("border-t", hair)}>
        <DemoTable monthIdx={monthIdx} onSeeWorkflow={seeWorkflow} />
      </div>
      {seen.has("workflow") && (
        <div role="tabpanel" id="demo-panel-workflow" aria-labelledby="demo-tab-workflow" hidden={tab !== "workflow"}>
          <DemoWorkflow key={flow.n} monthIdx={monthIdx} start={flow.start} />
        </div>
      )}
      {seen.has("payments") && (
        <div role="tabpanel" id="demo-panel-payments" aria-labelledby="demo-tab-payments" hidden={tab !== "payments"} className={cn("border-t", hair)}>
          <p className="px-4 py-3 text-muted-foreground sm:px-5">
            <b className="font-medium text-foreground">Payments are locked in this demo.</b> In SIMULATION Kleeno calculates and checks everything but never sends money.
          </p>
          <table className={cn("w-full border-separate border-spacing-0", num)}>
            <thead>
              <tr className="text-left text-muted-foreground">
                {["Batch", "Payments", "Status", "Amount"].map((h, i) => (
                  <th key={h} scope="col" className={cn("h-9 border-y bg-[#F7F7F5] px-2.5 font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", hair, i === 3 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cn("h-10 border-b px-2.5 pl-4 sm:pl-5", hair)}>Batch {month.run}-A</td>
                <td className={cn("h-10 border-b px-2.5", hair)}>{readyCount}</td>
                <td className={cn("h-10 border-b px-2.5", hair)}>
                  <span className={cn("inline-block rounded-[0.25rem] px-[7px]", monthIdx === 0 ? "bg-tag-gray text-tag-gray-fg" : "bg-success-soft text-success")}>{monthIdx === 0 ? "Not sent (simulation)" : "Settled · verified"}</span>
                </td>
                <td className={cn("h-10 border-b px-2.5 pr-4 text-right sm:pr-5", hair)}>{usd(readyAmount)}</td>
              </tr>
              {monthIdx === 0 && (
                <tr>
                  <td className={cn("h-10 px-2.5 pl-4 sm:pl-5", hair)}>Held out</td>
                  <td className="h-10 px-2.5">2</td>
                  <td className="h-10 px-2.5"><span className="inline-block rounded-[0.25rem] bg-signal/10 px-[7px] font-medium text-signal">1 needs review · 1 on hold</span></td>
                  <td className="h-10 px-2.5 pr-4 text-right sm:pr-5">{usd(7800 + 6390)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {seen.has("activity") && (
        <div role="tabpanel" id="demo-panel-activity" aria-labelledby="demo-tab-activity" hidden={tab !== "activity"} className={cn("border-t", hair)}>
          <ol className="px-4 py-3 sm:px-5">
            {(monthIdx === 0
              ? [["Oct 10 · 14:02", "Payment plan signed by Sam Ortiz (payment approver)", true], ["Oct 8 · 16:40", "Payroll approved by Leo Hart (HR approver)", true], ["Oct 8 · 11:15", "Kenji Watanabe's 142 hours flagged: contract cap is 140", false], ["Oct 7 · 09:30", "Timesheet CSV imported, 14 rows", false], ["Aug 28 · 10:00", "Pay policy v3 approved", false]]
              : [[`${month.label.split(" ")[0].slice(0, 3)} 30 · 10:12`, "Payments settled on Arc, receipts matched", true], [`${month.label.split(" ")[0].slice(0, 3)} 28 · 15:20`, "Payment plan signed by Sam Ortiz (payment approver)", true], [`${month.label.split(" ")[0].slice(0, 3)} 27 · 11:05`, "Payroll approved by Leo Hart (HR approver)", true], [`${month.label.split(" ")[0].slice(0, 3)} 25 · 09:30`, `Timesheet CSV imported, ${s.workers} rows`, false]]
            ).map(([when, what, key]) => (
              <li key={String(when)} className="grid grid-cols-[7.5rem_0.75rem_1fr] items-start gap-x-3 py-1.5">
                <time className="text-xs text-muted-foreground">{when}</time>
                <span aria-hidden className={cn("mt-1.5 size-2 rounded-full", key ? "bg-signal" : "bg-foreground")} />
                <span>{what}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </figure>
  );
}
