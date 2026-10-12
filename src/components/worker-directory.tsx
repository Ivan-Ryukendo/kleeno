"use client";

import { AlertTriangle, Check, ChevronRight, Clock, LayoutGrid, List, Search, SlidersHorizontal, User, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Chip, Notice } from "@/components/people-ui";
import { LocalNameUnlock } from "@/components/local-name-unlock";
import { WorkerActions, type WorkerView } from "@/components/worker-forms";
import { cn } from "@/lib/utils";

// All Workers directory (mockups/workers.html): filters with counts, search, list or cards. Names exist only in this browser (rule 35);
// the server sends codes, job labels and the payout-wallet state. Pay amounts are in Payroll, never in this list.
export interface DirectoryRow {
  id: string;
  code: string;
  payType: string;
  active: boolean;
  leftOn: string | null;
  /** Employee or contractor from worker details; null when not specified (or the role cannot read details). */
  type: "EMPLOYEE" | "CONTRACTOR" | null;
  jobTitle: string | null;
  department: string | null;
  startDate: string | null;
  /** null: the role cannot see payout-wallet state. */
  wallet: "VERIFIED" | "PENDING" | "NONE" | null;
  /** Present only for roles that may act on workers (editors and recipient confirmers). */
  view?: WorkerView;
}
type Filter = "all" | "employees" | "contractors" | "active" | "left" | "attention";

const payLabel = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
const typeLabel = { EMPLOYEE: "Employee", CONTRACTOR: "Contractor" } as const;
const date = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : null);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
const needsAttention = (r: DirectoryRow) => r.active && r.wallet === "PENDING";

export function WorkerDirectory({ rows, detail, canEdit, canConfirm, contextKey, company }: { rows: DirectoryRow[]; detail: boolean; canEdit: boolean; canConfirm: boolean; contextKey: string; company: string }) {
  const id = useId();
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayout] = useState<"list" | "cards">("list");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const codes = useMemo(() => rows.map((r) => r.code), [rows]);
  const pending = rows.filter(needsAttention);

  const counts = {
    all: rows.length,
    employees: rows.filter((r) => r.type === "EMPLOYEE").length,
    contractors: rows.filter((r) => r.type === "CONTRACTOR").length,
    active: rows.filter((r) => r.active).length,
    left: rows.filter((r) => !r.active).length,
    attention: pending.length,
  };
  const chips: { id: Filter; label: string; show: boolean }[] = [
    { id: "all", label: "All", show: true },
    { id: "employees", label: "Employees", show: detail },
    { id: "contractors", label: "Contractors", show: detail },
    { id: "active", label: "Active", show: true },
    { id: "left", label: "Left", show: true },
    { id: "attention", label: "Needs attention", show: detail && counts.attention > 0 },
  ];
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter === "employees" && r.type !== "EMPLOYEE") return false;
    if (filter === "contractors" && r.type !== "CONTRACTOR") return false;
    if (filter === "active" && !r.active) return false;
    if (filter === "left" && r.active) return false;
    if (filter === "attention" && !needsAttention(r)) return false;
    if (!q) return true;
    return [r.code, r.jobTitle, r.department, names[r.code]].some((v) => v?.toLowerCase().includes(q));
  });
  const nameOf = (r: DirectoryRow) => names[r.code];
  const cards = layout === "cards";

  return (
    <div className="space-y-3">
      <LocalNameUnlock key={contextKey} contextKey={contextKey} workerCodes={codes} onChange={setNames} variant="strip" />

      {pending.length > 0 && (
        <Notice tone="risk" icon={Wallet} role="status">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-[13.75rem] flex-1">
              <p className="font-medium text-signal">{pending.length === 1 ? `Payout wallet change for ${nameOf(pending[0]!) ? `${nameOf(pending[0]!)} · ` : ""}${pending[0]!.code} is waiting for a second approver` : `${pending.length} payout wallet changes are waiting for a second approver`}</p>
              <p className="mt-0.5 text-sm">A payment approver other than the person who set the address must confirm it with their password. Until then {pending.length === 1 ? "this worker cannot" : "these workers cannot"} be paid: <b>DO NOT PAY</b>{pending.length > 1 ? ` (${pending.map((p) => p.code).join(", ")})` : ""}.</p>
            </div>
            <button type="button" className="inline-flex h-8 items-center rounded-field border border-border bg-background px-3 text-sm font-medium hover:bg-accent" onClick={() => setFilter("attention")}>Show {pending.length === 1 ? "it" : "them"}</button>
          </div>
        </Notice>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 max-w-70 flex-[1_1_10rem] max-[520px]:max-w-none max-[520px]:basis-full">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={detail ? "Search name, code or job" : "Search name or code"}
            aria-label="Search workers"
            className="h-9 w-full rounded-field border border-field-border bg-white pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 max-[520px]:text-base"
          />
        </div>
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <legend className="sr-only">Filter workers</legend>
          {chips.filter((c) => c.show).map((c) => (
            <label key={c.id} className={cn("inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-field border px-2.5 text-sm font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary", filter === c.id ? "border-foreground bg-accent text-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground")}>
              <input type="radio" name={`${id}-filter`} className="sr-only" checked={filter === c.id} onChange={() => setFilter(c.id)} />
              {c.id === "attention" && <AlertTriangle aria-hidden="true" className="size-3.5 text-signal" />}
              {c.label}
              <span className="font-normal text-muted-foreground tabular-nums">{counts[c.id]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="m-0 ml-auto flex min-w-0 gap-0.5 rounded-field border border-border p-0.5 max-[520px]:ml-0">
          <legend className="sr-only">Layout</legend>
          {([["list", "List", List], ["cards", "Cards", LayoutGrid]] as const).map(([value, text, Icon]) => (
            <label key={value} className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-chip px-2.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary", layout === value ? "bg-accent text-foreground" : "text-muted-foreground")}>
              <input type="radio" name={`${id}-layout`} className="sr-only" checked={layout === value} onChange={() => setLayout(value)} />
              <Icon aria-hidden="true" className="size-4" />
              {text}
            </label>
          ))}
        </fieldset>
      </div>

      <section aria-label="Worker directory" className={cn(!cards && "overflow-hidden rounded-card border border-border bg-card")}>
        {!cards && shown.length > 0 && (
          <div aria-hidden="true" className={cn("hidden h-9 items-center gap-2.5 border-b border-border bg-secondary px-3.5 text-sm font-medium text-muted-foreground min-[1260px]:grid", detail ? "grid-cols-[minmax(190px,1.7fr)_minmax(140px,1.4fr)_minmax(100px,1fr)_64px_92px_150px_112px_32px]" : "grid-cols-[minmax(190px,1.7fr)_90px_112px_32px]")}>
            <span>Worker</span>
            {detail && <><span>Job title</span><span>Department</span></>}
            <span>Pay type</span>
            {detail && <><span>Start date</span><span>Payout wallet</span></>}
            <span>Status</span>
            <span />
          </div>
        )}
        {shown.length > 0 ? (
          <ul className={cn("m-0 list-none p-0", cards && "grid grid-cols-[repeat(auto-fill,minmax(15.6rem,1fr))] gap-3")}>
            {shown.map((r) => {
              const name = nameOf(r);
              const manage = (canEdit || canConfirm) && r.view;
              const expanded = open === r.id;
              return (
                <li key={r.id} className={cn("relative", cards ? "rounded-card border border-border bg-card transition-colors hover:border-field-border" : "border-b border-border last:border-b-0")}>
                  <div
                    className={cn(
                      "relative gap-x-2 gap-y-1.5 px-3.5 py-2.5 transition-colors duration-150 hover:bg-[#FAFAF9]",
                      cards
                        ? "grid grid-cols-[5.75rem_minmax(0,1fr)] items-center rounded-card p-3.5"
                        : cn("flex flex-wrap items-center min-[1260px]:grid min-[1260px]:min-h-14 min-[1260px]:gap-2.5", detail ? "min-[1260px]:grid-cols-[minmax(190px,1.7fr)_minmax(140px,1.4fr)_minmax(100px,1fr)_64px_92px_150px_112px_32px]" : "min-[1260px]:grid-cols-[minmax(190px,1.7fr)_90px_112px_32px]"),
                    )}
                  >
                    <span className={cn("flex min-w-0 items-center gap-2.5", cards ? "col-span-full mb-1.5" : "flex-[1_1_9rem] min-[1260px]:flex-none")}>
                      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-sidebar-accent font-semibold", cards ? "size-9 text-sm" : "size-7 text-xs")}>
                        {name ? initials(name) : <User className="size-4 text-muted-foreground" />}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/workers?worker=${r.id}`} className="block truncate font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" aria-label={`${name ?? r.code} history`}>
                          {name ?? <span className="font-normal text-muted-foreground">Name locked</span>}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{r.code}{r.type ? ` · ${typeLabel[r.type]}` : ""}</span>
                      </span>
                    </span>

                    {detail && (
                      <>
                        <Cell label="Job title" cards={cards} className="order-2 ml-[2.375rem] min-[1260px]:order-none min-[1260px]:ml-0">{r.jobTitle ? <Tag>{r.jobTitle}</Tag> : <Dash />}</Cell>
                        <Cell label="Department" cards={cards} className="order-3 min-[1260px]:order-none">{r.department ? <Tag>{r.department}</Tag> : <Dash />}</Cell>
                      </>
                    )}
                    <Cell label="Pay type" cards={cards} className="hidden text-sm min-[1260px]:block" always={cards}>{payLabel(r.payType)}</Cell>
                    {detail && (
                      <>
                        <Cell label="Start date" cards={cards} className="hidden text-sm min-[1260px]:block" always={cards}>{date(r.startDate) ?? <Dash />}</Cell>
                        <Cell label="Payout wallet" cards={cards} className={cn("order-4 min-[1260px]:order-none", r.wallet !== "PENDING" && !cards && "hidden min-[1260px]:block")} always={cards}>
                          <span className="flex flex-col items-start gap-0.5 max-[1259px]:flex-row max-[1259px]:items-center max-[1259px]:gap-1.5">
                            {r.wallet === "VERIFIED" && <Chip tone="ok"><Check aria-hidden="true" className="size-3" />Verified</Chip>}
                            {r.wallet === "PENDING" && <Chip tone="risk"><Clock aria-hidden="true" className="size-3" />Change pending</Chip>}
                            {r.wallet === "NONE" && <Chip>No wallet yet</Chip>}
                            {r.wallet === "PENDING" && <small className="text-xs text-signal">Needs second approval</small>}
                          </span>
                        </Cell>
                      </>
                    )}
                    <Cell label="Status" cards={cards} className="order-1 min-[1260px]:order-none" always={cards}>
                      {r.active ? (
                        <Chip><span aria-hidden="true" className="size-1.5 rounded-full bg-success" />Active</Chip>
                      ) : (
                        <Chip>Left{r.leftOn ? ` ${date(r.leftOn)}` : ""}</Chip>
                      )}
                    </Cell>
                    {manage ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`${id}-manage-${r.id}`}
                        aria-label={`${expanded ? "Close" : "Manage"} ${r.code}`}
                        title={`${expanded ? "Close" : "Manage"} ${r.code}`}
                        onClick={() => setOpen(expanded ? null : r.id)}
                        className={cn("relative z-10 order-1 inline-grid size-8 shrink-0 place-items-center rounded-field text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[1259px]:size-11 min-[1260px]:order-none", cards && "absolute top-2 right-2", expanded && "bg-accent text-foreground")}
                      >
                        <SlidersHorizontal aria-hidden="true" className="size-4" />
                      </button>
                    ) : !cards ? (
                      <ChevronRight aria-hidden="true" className="hidden size-4 text-muted-foreground min-[1260px]:block" />
                    ) : null}
                  </div>
                  {manage && expanded && r.view && (
                    <div id={`${id}-manage-${r.id}`} className="border-t border-border bg-secondary/50 px-3.5 py-3">
                      <WorkerActions w={r.view} canEdit={canEdit} canConfirm={canConfirm} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-10 text-center text-muted-foreground">
            <Users aria-hidden="true" className="mx-auto mb-2 size-7" />
            {filter === "left" && !q ? (
              <>
                <p className="font-medium text-foreground">No one has left {company}.</p>
                <p className="mt-1 text-xs">When someone leaves, their profile and payment history stay here, read-only. Records are never deleted.</p>
              </>
            ) : (
              <p>No workers match this filter{q ? " and search" : ""}.</p>
            )}
          </div>
        )}
        <div className={cn("flex flex-wrap justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground", !cards && "border-t border-border")}>
          <span aria-live="polite">Showing {shown.length} of {rows.length}</span>
          <span>{detail ? "Pay amounts are in Payroll, not here" : "Your role sees worker codes and pay type only"}</span>
        </div>
      </section>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return <span className="inline-block max-w-full truncate rounded-chip bg-accent px-1.5 text-sm leading-5">{children}</span>;
}
const Dash = () => <span className="text-muted-foreground" aria-label="Not set">—</span>;

/** A labelled value: the label is read by screen readers in the list and shown in card layout. */
function Cell({ label, cards, always = false, className, children }: { label: string; cards: boolean; always?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("min-w-0", cards ? "contents" : className, cards && always && "contents")}>
      <span className={cards ? "text-xs text-muted-foreground" : "sr-only"}>{label}</span>
      <span className={cn(cards && "justify-self-start text-sm")}>{children}</span>
    </span>
  );
}
