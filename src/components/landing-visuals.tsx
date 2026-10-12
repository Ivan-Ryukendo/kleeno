// Product-true renderings for the public landing page (DESIGN.md §1-9, rule 45).
// Every figure here is illustrative and synthetic (W001-style codes, no names, no real pay); rule 42 forbids presenting it as traction.
// Pure markup: no hooks, so these stay server-rendered. Colours come from tokens only.

import { cn } from "@/lib/utils";

const chip = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";

function Status({ kind, children }: { kind: "ok" | "risk"; children: React.ReactNode }) {
  return (
    <span className={cn(chip, kind === "risk" ? "bg-signal text-white" : "border border-foreground/15 bg-background text-foreground")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", kind === "risk" ? "bg-white" : "bg-foreground/60")} />
      {children}
    </span>
  );
}

const runRows = [
  { code: "W001", type: "Salaried", hours: "—", net: "2,400.00", status: <Status kind="ok">Matched</Status> },
  { code: "W002", type: "Hourly", hours: "82.0", net: "3,075.00", status: <Status kind="ok">Matched</Status> },
  { code: "W003", type: "Hourly", hours: "96.5", net: "Held", status: <Status kind="risk">Exception: duplicate timesheet</Status> },
  { code: "W004", type: "Retainer", hours: "—", net: "Held", status: <Status kind="risk">DO NOT PAY: wallet changed</Status> },
  { code: "W005", type: "Hourly", hours: "42.0", net: "1,612.50", status: <Status kind="ok">Matched</Status> },
];

/** Hero: an illustrative pay-run review, as the reviewer sees it before approving. */
export function RunReviewVisual() {
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-[1.25rem] bg-card text-left text-foreground shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4 sm:px-7">
          <div>
            <p className="text-base font-medium tracking-[-0.02em]">Pay run · 1–15 September</p>
            <p className="text-sm text-muted-foreground">5 workers · policy version 3 · USD</p>
          </div>
          <span className={cn(chip, "border border-foreground/20 bg-white text-foreground")}>SIMULATION · no money moves</span>
        </div>
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <caption className="sr-only">Illustrative pay run with synthetic workers</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-medium sm:px-7">Worker</th>
              <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">Pay type</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Hours</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Net pay</th>
              <th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell sm:px-7">Status</th>
            </tr>
          </thead>
          <tbody>
            {runRows.map((r) => (
              <tr key={r.code} className="border-t border-foreground/10">
                <th scope="row" className="px-5 py-3 text-left font-medium sm:px-7">
                  {r.code}
                  <span className="mt-1 block sm:hidden">{r.status}</span>
                </th>
                <td className="hidden px-3 py-3 md:table-cell">{r.type}</td>
                <td className="hidden px-3 py-3 text-right md:table-cell">{r.hours}</td>
                <td className="px-3 py-3 text-right font-medium">{r.net === "Held" ? <span className="text-signal">Held</span> : `$${r.net}`}</td>
                <td className="hidden px-5 py-3 sm:table-cell sm:px-7">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-foreground/10 px-5 py-3 text-sm text-muted-foreground sm:px-7">Every amount opens its calculation trace. Held rows wait for a person.</p>
      </div>
    </figure>
  );
}

/** Bento A: two timesheet rows that claim the same day. */
export function DuplicateTimesheetVisual() {
  const rows = [
    { day: "Mon 8 Sep", h: "8.0", src: "timesheet A", dup: false },
    { day: "Tue 9 Sep", h: "8.0", src: "timesheet A", dup: true },
    { day: "Tue 9 Sep", h: "8.0", src: "timesheet B", dup: true },
    { day: "Wed 10 Sep", h: "7.5", src: "timesheet A", dup: false },
  ];
  return (
    <div className="rounded-[1.25rem] bg-white p-4 shadow-nav sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">W003 · imported rows</p>
        <Status kind="risk">Exception</Status>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm [font-variant-numeric:tabular-nums]">
        {rows.map((r, i) => (
          <li key={i} className={cn("flex items-center justify-between gap-3 rounded-full px-3 py-2", r.dup ? "bg-signal/10 ring-1 ring-signal/40" : "bg-background")}>
            <span>{r.day}</span>
            <span className="text-muted-foreground">{r.src}</span>
            <span className="font-medium">{r.h} h</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">Duplicate timesheet: same worker, same day, two sources. Evidence attached; a person resolves it.</p>
    </div>
  );
}

/** Bento B: a recipient wallet that changed just before payday. */
export function WalletChangeVisual() {
  return (
    <div className="flex flex-col gap-3 rounded-[1.25rem] bg-white/10 p-4 ring-1 ring-white/15 sm:flex-row sm:items-center sm:p-5">
      <code className="rounded-full bg-white/10 px-3 py-2 text-sm text-white/80 line-through decoration-white/50">0x7a3d…91c4</code>
      <span aria-hidden className="text-white/60 sm:rotate-0">→</span>
      <code className="rounded-full bg-white px-3 py-2 text-sm text-foreground">0x1f08…e42b</code>
      <span className="sm:ml-auto"><Status kind="risk">DO NOT PAY until confirmed</Status></span>
    </div>
  );
}

/** Bento C: a policy sentence becoming a cited rule. */
export function PolicyRuleVisual() {
  return (
    <div className="space-y-2 text-sm">
      <blockquote className="rounded-[1.25rem] bg-background px-4 py-3 text-muted-foreground">“Hours above 40 in a week are paid at one and a half times the hourly rate.”</blockquote>
      <p className="rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground">overtime · 1.5× after 40 h/week · cites §4.2</p>
    </div>
  );
}

/** Bento D and proof card: a line-by-line calculation trace. */
export function TraceVisual({ dark = false }: { dark?: boolean }) {
  const lines = [
    ["Base", "40.0 h × $37.50", "1,500.00"],
    ["Overtime", "2.0 h × $56.25", "112.50"],
    ["Net pay", "", "1,612.50"],
  ];
  return (
    <dl className={cn("space-y-1 text-sm [font-variant-numeric:tabular-nums]", dark ? "text-white" : "text-foreground")}>
      {lines.map(([k, how, v], i) => (
        <div key={k} className={cn("grid grid-cols-[1fr_auto] gap-x-3 py-1.5", i === lines.length - 1 && (dark ? "border-t border-white/20 pt-2.5 font-medium" : "border-t border-foreground/15 pt-2.5 font-medium"))}>
          <dt>
            {k}
            {how && <span className={cn("ml-2", dark ? "text-white/70" : "text-muted-foreground")}>{how}</span>}
          </dt>
          <dd className="text-right">${v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Proof card: an import summary where names never left the browser. */
export function ImportVisual() {
  return (
    <ul className="grid gap-2 text-sm sm:grid-cols-3">
      {[
        ["Rows read", "In your browser"],
        ["Names", "Replaced by W-codes"],
        ["Mismatches", "Raised as exceptions"],
      ].map(([k, v]) => (
        <li key={k} className="rounded-[1.25rem] bg-background px-4 py-3">
          <p className="text-muted-foreground">{k}</p>
          <p className="mt-1 font-medium">{v}</p>
        </li>
      ))}
    </ul>
  );
}

/** Proof card: two different people sign two different approvals. */
export function ApprovalsVisual() {
  return (
    <ul className="space-y-2 text-sm">
      {[
        ["Payroll approval", "HR approver · re-entered password"],
        ["Payment approval", "Payment approver · a different person"],
      ].map(([k, v]) => (
        <li key={k} className="flex items-center justify-between gap-3 rounded-full bg-background py-2 pl-4 pr-2">
          <span>
            <span className="font-medium">{k}</span>
            <span className="ml-2 hidden text-muted-foreground sm:inline">{v}</span>
          </span>
          <span className={cn(chip, "bg-primary text-primary-foreground")}>Signed</span>
        </li>
      ))}
    </ul>
  );
}

/** Proof card: the worker's receipt on Arc testnet. Hash is a placeholder shape, not a real transaction. */
export function ReceiptVisual() {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm [font-variant-numeric:tabular-nums]">
      <div>
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="mt-0.5 text-lg font-medium">1,612.50 USDC</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Network</dt>
        <dd className="mt-0.5 font-medium">Arc testnet</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-muted-foreground">Transaction</dt>
        <dd className="mt-0.5 truncate font-mono text-sm">0x4be1…c09d · matched to obligation W005-0915</dd>
      </div>
    </dl>
  );
}

/** Small pill-shaped renderings that sit inline inside a heading (gpt-taste inline typography images). */
export function InlinePill({ variant }: { variant: "signers" | "trace" }) {
  return (
    <span aria-hidden className="mx-[0.15em] inline-flex h-[0.78em] w-[1.9em] -translate-y-[0.06em] items-center justify-center gap-[0.12em] overflow-hidden rounded-full bg-primary align-middle">
      {variant === "signers" ? (
        <>
          <span className="size-[0.32em] rounded-full bg-background" />
          <span className="size-[0.32em] rounded-full bg-orbit" />
        </>
      ) : (
        <span className="flex w-[1.2em] flex-col gap-[0.07em]">
          <span className="h-[0.06em] w-full rounded-full bg-background/80" />
          <span className="h-[0.06em] w-3/4 rounded-full bg-background/60" />
          <span className="h-[0.06em] w-1/2 rounded-full bg-orbit" />
        </span>
      )}
    </span>
  );
}
