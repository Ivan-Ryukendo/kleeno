"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Check, CircleAlert, CirclePause } from "lucide-react";
import { cn } from "@/lib/utils";
import { panClasses, useSpacePan } from "@/components/use-space-pan";
import { avatars, columns, months, monthRows, monthSummary, type CheckKind, type ColumnKey, type DemoWorker, type Tag, type TagTone } from "@/components/landing-demo-data";

// The Payroll table of the landing-page demo: the full table from docs/mockups/payroll-table.html (17 columns, 14 people),
// same tags and status chips as the product. Click a cell to see where the number comes from; hold Space and drag to pan.

const tagTone: Record<TagTone, string> = {
  gray: "bg-tag-gray text-tag-gray-fg",
  brown: "bg-tag-brown text-tag-brown-fg",
  yellow: "bg-tag-yellow text-tag-yellow-fg",
  green: "bg-tag-green text-tag-green-fg",
  blue: "bg-tag-blue text-tag-blue-fg",
  purple: "bg-tag-purple text-tag-purple-fg",
  pink: "bg-tag-pink text-tag-pink-fg",
};
const numeric = new Set<ColumnKey>(["monthly", "taxPct", "tax", "monthlyCost", "annual", "annualCost", "raisePct", "raise", "after", "months", "paid"]);
const checkLabel: Record<CheckKind, string> = { matched: "Matched", review: "Needs review", hold: "On hold" };
const num = "[font-variant-numeric:tabular-nums]";

function TagChip({ tag }: { tag: Tag }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-[0.25rem] px-[7px] text-[0.8125rem] leading-5", tagTone[tag[0]])}>{tag[1]}</span>;
}

function CheckChip({ kind }: { kind: CheckKind }) {
  const Icon = kind === "review" ? CircleAlert : kind === "hold" ? CirclePause : Check;
  return (
    <span className={cn("inline-flex items-center gap-[5px] whitespace-nowrap rounded-[0.25rem] px-[7px] text-[0.8125rem] font-medium leading-5", kind === "matched" ? "bg-success-soft text-success" : "bg-signal/10 text-signal")}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {checkLabel[kind]}
    </span>
  );
}

function cellValue(w: DemoWorker, key: ColumnKey) {
  switch (key) {
    case "check": return <CheckChip kind={w.check} />;
    case "job": case "dept": case "type": case "expense": return <TagChip tag={w[key]} />;
    case "months": return String(w.months);
    default: return w[key];
  }
}

function plainValue(w: DemoWorker, key: ColumnKey) {
  switch (key) {
    case "check": return checkLabel[w.check];
    case "job": case "dept": case "type": case "expense": return w[key][1];
    case "months": return String(w.months);
    default: return w[key];
  }
}

export function Avatar({ code, name, size = 26 }: { code: string; name: string; size?: number }) {
  const src = avatars[code];
  if (!src) return <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full bg-foreground text-[0.6875rem] font-semibold text-white" style={{ width: size, height: size }}>{name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>;
  return <Image src={src} alt="" width={size} height={size} sizes={`${size}px`} className="shrink-0 rounded-full border border-foreground/10 object-cover" style={{ width: size, height: size }} />;
}

export function DemoTable({ monthIdx, onSeeWorkflow }: { monthIdx: number; onSeeWorkflow: (code: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ r: number; c: ColumnKey } | null>(null);
  useSpacePan(scroller);

  const rows = monthRows(monthIdx);
  const s = monthSummary(rows);
  const selected = sel ? { w: rows[sel.r], col: columns.find((c) => c.key === sel.c)! } : null;

  const th = "sticky top-0 z-10 h-9 whitespace-nowrap border-b border-r border-foreground/10 bg-[#F7F7F5] px-2.5 text-left text-[0.8125rem] font-medium text-muted-foreground";
  const td = "h-10 whitespace-nowrap border-b border-r border-foreground/10 p-0 text-left font-normal";
  const cell = "flex h-10 w-full cursor-pointer items-center px-2.5 text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]";

  return (
    <div>
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label="Payroll table. Scroll sideways for more columns, or hold Space and drag."
        className={cn("relative max-h-[28rem] overflow-auto overscroll-contain outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] sm:max-h-[31rem]", panClasses)}
      >
        <table className={cn("w-max min-w-full border-separate border-spacing-0", num)}>
          <caption className="sr-only">Payroll table for {months[monthIdx].label}, sample company Northwind Remote</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, "left-0 z-20 min-w-[13.5rem] pl-3 sm:pl-5")}>Name</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" title={c.source || undefined} className={cn(th, numeric.has(c.key) && "text-right", "min-w-[8.5rem]")}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, r) => (
              <tr key={w.code} className="group/row">
                <th scope="row" className={cn(td, "sticky left-0 z-[5] bg-white pl-3 group-hover/row:bg-[#FAFAF9] sm:pl-5", w.check !== "matched" && "bg-[#FEF9F6]")}>
                  <span className="flex items-center gap-2">
                    <Avatar code={w.code} name={w.name} />
                    <b className="font-medium">{w.name}</b>
                    <span className="text-xs text-muted-foreground">{w.code}</span>
                  </span>
                </th>
                {columns.map((c) => {
                  const on = sel?.r === r && sel.c === c.key;
                  return (
                    <td key={c.key} className={cn(td, "bg-white group-hover/row:bg-[#FAFAF9]", w.check !== "matched" && "bg-[#FEF9F6]", on && "bg-[#F3F6FC] shadow-[inset_0_0_0_2px_#3860BE]")}>
                      <button type="button" onClick={() => setSel(on ? null : { r, c: c.key })} aria-pressed={on} aria-label={`${w.name}, ${c.label}: ${plainValue(w, c.key)}`} className={cn(cell, numeric.has(c.key) && "justify-end")}>
                        {cellValue(w, c.key)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="sticky bottom-0 left-0 z-20 h-9 border-t border-r border-foreground/10 bg-white py-1.5 pl-3 sm:pl-5">{`Count ${s.workers}`}</td>
              <td className="sticky bottom-0 z-10 h-9 whitespace-nowrap border-t border-r border-foreground/10 bg-white px-2.5">{`Matched ${s.matched} of ${s.workers}`}</td>
              {columns.slice(1).map((c) => (
                <td key={c.key} className={cn("sticky bottom-0 z-10 h-9 whitespace-nowrap border-t border-r border-foreground/10 bg-white px-2.5", numeric.has(c.key) && "text-right")}>{s.footer[c.key] ?? ""}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div aria-live="polite" className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-t border-foreground/10 px-4 py-2.5 text-muted-foreground sm:px-5">
        {selected ? (
          <>
            <span><b className="font-medium text-foreground">{selected.w.name} · {selected.col.label}</b> = {plainValue(selected.w, selected.col.key)}</span>
            <span>{selected.col.source ? `Comes from: ${selected.col.source}` : "A fact from the worker record."}</span>
            {["monthly", "tax", "monthlyCost"].includes(selected.col.key) && (
              <button type="button" onClick={() => onSeeWorkflow(selected.w.code)} className="inline-flex h-8 cursor-pointer items-center rounded-[0.375rem] border border-foreground/20 px-3 font-medium text-foreground hover:bg-muted">
                See it in the Workflow
              </button>
            )}
          </>
        ) : (
          <span>Click any number to see where it comes from. Hold <kbd className="rounded-[0.25rem] border border-foreground/40 px-1.5 text-xs text-foreground">Space</kbd> and drag to move around the table.</span>
        )}
      </div>
    </div>
  );
}

