"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/landing-demo-table";
import { workers } from "@/components/landing-demo-data";
import type { PersonInfo, PersonStatus } from "@/components/landing-demo-graph";

// Find anyone's workflow by name. Every worker is in the list, working or not: a green chip means every check passed,
// an orange one means the workflow is under review or on hold and says why when you open it.

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const statusText: Record<PersonStatus, string> = { matched: "Matched", review: "Needs review", hold: "On hold" };
const filters: { id: "all" | PersonStatus; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "matched", label: "Working correctly" },
  { id: "review", label: "Under review" },
  { id: "hold", label: "On hold" },
];

export function StatusChip({ status }: { status: PersonStatus }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-[0.25rem] px-[7px] text-[0.8125rem] font-medium leading-5", status === "matched" ? "bg-success-soft text-success" : "bg-signal/10 text-signal")}>{statusText[status]}</span>;
}

export function PersonPicker({ list, value, onChange }: { list: PersonInfo[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | PersonStatus>("all");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = list.find((p) => p.id === value) ?? list[0];
  const dept = useMemo(() => new Map(workers.map((w) => [w.code, w.dept[1]])), []);

  const counts = { all: list.length, matched: list.filter((p) => p.status === "matched").length, review: list.filter((p) => p.status === "review").length, hold: list.filter((p) => p.status === "hold").length };
  const shown = useMemo(() => {
    const t = fold(q.trim());
    return list.filter((p) => (filter === "all" || p.status === filter) && (!t || fold(`${p.name} ${p.id} ${p.job} ${dept.get(p.id) ?? ""} ${p.kind}`).includes(t)));
  }, [list, q, filter, dept]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && shown[active]) { e.preventDefault(); pick(shown[active].id); }
  };

  return (
    <div ref={root} className="relative" onKeyDown={key}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setActive(0); setTimeout(() => input.current?.focus(), 0); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-[0.375rem] border border-foreground/20 bg-white pl-1.5 pr-2.5 text-[0.8125rem] font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <Avatar code={current.id} name={current.name} size={24} />
        <span className="truncate">{current.name}</span>
        <StatusChip status={current.status} />
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(24rem,calc(100vw-2rem))] rounded-[0.5rem] border border-foreground/15 bg-white p-2 shadow-pop">
          <label className="relative block">
            <span className="sr-only">Search workflows by name</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search by name, code or job" className="h-9 w-full rounded-[0.375rem] border border-foreground/15 bg-card pl-8 pr-2 text-[0.8125rem] outline-none focus:border-foreground focus:bg-white" />
          </label>
          <div role="group" aria-label="Filter by status" className="mt-2 flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setActive(0); }} className={cn("h-7 cursor-pointer rounded-[0.375rem] border px-2 text-xs font-medium", filter === f.id ? "border-foreground bg-foreground text-white" : "border-foreground/15 bg-white hover:bg-muted")}>
                {f.label} <span className="opacity-60">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <ul id={listId} role="listbox" aria-label="Workflows" className="mt-2 max-h-72 overflow-auto">
            {shown.map((p, i) => (
              <li key={p.id} role="option" aria-selected={p.id === value} onClick={() => pick(p.id)} onMouseEnter={() => setActive(i)} className={cn("flex cursor-pointer items-center gap-2.5 rounded-[0.375rem] px-2 py-1.5", i === active && "bg-muted")}>
                <Avatar code={p.id} name={p.name} size={32} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[0.8125rem] font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">{p.id}</span></b>
                  <span className="block truncate text-xs text-muted-foreground">{p.job} · {p.kind}</span>
                </span>
                <StatusChip status={p.status} />
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-3 text-[0.8125rem] text-muted-foreground">No workflow matches. Try a name, a code like W004, or a job title.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
