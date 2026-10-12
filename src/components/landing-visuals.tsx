// Product renderings for the public landing page. They copy the approved product mockups (docs/mockups/payroll-table.html,
// payroll-import.html, payroll-calculation.html, payroll-payments.html, receipt.html) and the built screens: the sample
// company "Northwind Remote", its people and amounts are the mockups' own sample data, money is Arc testnet USDC in
// SIMULATION, and wallets/transactions appear only as short fragments (never a full address or hash).
// Product look on purpose (DESIGN.md §11: white surface, hairlines, 13px text, 4px chips, 8px corners) so visitors see the
// real app. Pure markup, no hooks, so these stay server-rendered. Colours come from tokens only.

import { CalendarDays, Check, ChevronDown, CircleAlert, CirclePause } from "lucide-react";
import { cn } from "@/lib/utils";

const text13 = "text-[0.8125rem] leading-5";
const hair = "border-foreground/10";
const num = "[font-variant-numeric:tabular-nums]";

type TagTone = "gray" | "brown" | "yellow" | "green" | "blue" | "purple" | "pink";
const tagTone: Record<TagTone, string> = {
  gray: "bg-tag-gray text-tag-gray-fg",
  brown: "bg-tag-brown text-tag-brown-fg",
  yellow: "bg-tag-yellow text-tag-yellow-fg",
  green: "bg-tag-green text-tag-green-fg",
  blue: "bg-tag-blue text-tag-blue-fg",
  purple: "bg-tag-purple text-tag-purple-fg",
  pink: "bg-tag-pink text-tag-pink-fg",
};

function Tag({ tone, children }: { tone: TagTone; children: React.ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-[0.25rem] px-[7px] text-[0.8125rem] leading-5", tagTone[tone])}>{children}</span>;
}

type StatusKind = "matched" | "review" | "hold" | "ok";
/** Check column chip, as in the product: Matched (success tint) or Needs review / On hold (risk tint). */
function Status({ kind, children }: { kind: StatusKind; children: React.ReactNode }) {
  const risk = kind === "review" || kind === "hold";
  const Icon = kind === "review" ? CircleAlert : kind === "hold" ? CirclePause : Check;
  return (
    <span className={cn("inline-flex items-center gap-[5px] whitespace-nowrap rounded-[0.25rem] px-[7px] text-[0.8125rem] font-medium leading-5", risk ? "bg-signal/10 text-signal" : "bg-success-soft text-success")}>
      <Icon aria-hidden className="hidden size-3.5 sm:block" strokeWidth={2.25} />
      {children}
    </span>
  );
}

/** Top-bar run mode badge (product shell). */
function ModeChip() {
  return <span className="rounded-[0.25rem] border border-foreground/15 px-1.5 py-0.5 text-xs font-semibold tracking-[0.02em]">SIMULATION</span>;
}

function Person({ name, code }: { name: string; code: string }) {
  return (
    <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
      <b className="font-medium">{name}</b>
      <span className="text-xs text-muted-foreground">{code}</span>
    </span>
  );
}

const runRows: { name: string; code: string; status: [StatusKind, string]; job: [TagTone, string]; dept: [TagTone, string]; type: [TagTone, string]; pay: string }[] = [
  { name: "Ava Chen", code: "W001", status: ["matched", "Matched"], job: ["pink", "CEO & Co-founder"], dept: ["green", "Management"], type: ["blue", "Salaried"], pay: "$9,000.00" },
  { name: "Marcus Bell", code: "W002", status: ["matched", "Matched"], job: ["gray", "CTO"], dept: ["blue", "Engineering"], type: ["blue", "Salaried"], pay: "$8,500.00" },
  { name: "Sofia Ramos", code: "W003", status: ["matched", "Matched"], job: ["green", "Head of Sales"], dept: ["pink", "Sales"], type: ["brown", "Retainer"], pay: "$6,000.00" },
  { name: "Kenji Watanabe", code: "W004", status: ["review", "Needs review"], job: ["brown", "Front-end developer"], dept: ["blue", "Engineering"], type: ["purple", "Hourly"], pay: "$6,390.00" },
  { name: "Lena Fischer", code: "W005", status: ["matched", "Matched"], job: ["blue", "HR lead"], dept: ["brown", "People"], type: ["blue", "Salaried"], pay: "$5,200.00" },
  { name: "Noah Kim", code: "W014", status: ["hold", "On hold"], job: ["purple", "DevOps engineer"], dept: ["blue", "Engineering"], type: ["purple", "Hourly"], pay: "$7,800.00" },
];

/** Hero: the Payroll page, Table tab, as a reviewer sees it before approving (mockups/payroll-table.html). */
export function RunReviewVisual() {
  const th = cn("h-9 border-b px-2 text-left font-medium text-muted-foreground sm:px-2.5", hair);
  const td = cn("h-10 border-b px-2 py-1.5 sm:px-2.5 sm:py-0", hair);
  return (
    <figure className={cn("w-full overflow-hidden rounded-[0.5rem] bg-white text-left text-foreground", text13)}>
      <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5", hair)}>
        <p className="truncate text-muted-foreground">
          Northwind Remote <span aria-hidden>/</span> Payroll <span aria-hidden>/</span> <span className="text-foreground">October 2026</span>
        </p>
        <ModeChip />
      </div>
      <div className="px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-xl font-medium tracking-tight sm:text-2xl">Payroll</p>
          <span className={cn("inline-flex h-8 items-center gap-2 rounded-[0.375rem] border px-3 font-medium", hair)}>
            <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
            October 2026 · Run 10
            <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
          </span>
        </div>
        <div className={cn("mt-3 flex gap-0.5 overflow-hidden border-b", hair)}>
          {["Table", "Workflow", "Payments", "Activity"].map((t, i) => (
            <span key={t} className={cn("-mb-px border-b-2 px-2.5 py-2 font-medium", i === 0 ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")}>{t}</span>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span><b className={cn("font-medium text-foreground", num)}>14</b> workers</span>
          <span><b className={cn("font-medium text-foreground", num)}>12</b> matched automatically</span>
          <span className="font-medium text-signal">1 needs review</span>
          <span className="font-medium text-signal">1 on hold</span>
          <span className="hidden lg:inline">Click any number to see how it is calculated</span>
        </p>
      </div>
      <div className="mt-3 overflow-hidden">
        <table className={cn("w-full border-separate border-spacing-0", num)}>
          <caption className="sr-only">Payroll table for October 2026, sample company Northwind Remote</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, "pl-3 sm:pl-5")}>Name</th>
              <th scope="col" className={th}>Check</th>
              <th scope="col" className={cn(th, "hidden lg:table-cell")}>Job title</th>
              <th scope="col" className={cn(th, "hidden xl:table-cell")}>Department</th>
              <th scope="col" className={cn(th, "hidden md:table-cell")}>Pay type</th>
              <th scope="col" className={cn(th, "pr-3 text-right sm:pr-5")}>Monthly pay</th>
            </tr>
          </thead>
          <tbody>
            {runRows.map((r) => (
              <tr key={r.code} className={r.status[0] !== "matched" ? "bg-signal/[0.03]" : undefined}>
                <th scope="row" className={cn(td, "pl-3 text-left font-normal sm:pl-5")}>
                  <Person name={r.name} code={r.code} />
                </th>
                <td className={td}><Status kind={r.status[0]}>{r.status[1]}</Status></td>
                <td className={cn(td, "hidden lg:table-cell")}><Tag tone={r.job[0]}>{r.job[1]}</Tag></td>
                <td className={cn(td, "hidden xl:table-cell")}><Tag tone={r.dept[0]}>{r.dept[1]}</Tag></td>
                <td className={cn(td, "hidden md:table-cell")}><Tag tone={r.type[0]}>{r.type[1]}</Tag></td>
                <td className={cn(td, "whitespace-nowrap pr-3 text-right sm:pr-5")}>{r.pay}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="h-9 py-1.5 pl-3 sm:pl-5">Count 14</td>
              <td className="h-9 px-2 py-1.5 sm:px-2.5">Matched 12 of 14</td>
              <td className="hidden lg:table-cell" />
              <td className="hidden xl:table-cell" />
              <td className="hidden md:table-cell" />
              <td className="h-9 whitespace-nowrap pr-3 text-right sm:pr-5"><span className="hidden font-normal text-muted-foreground sm:inline">Sum </span>$79,102.00</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}

/** Bento A: import check comparing hours with last month (mockups/payroll-import.html, "Valid rows by worker"). */
export function HoursCheckVisual() {
  const rows = [
    { name: "Kenji Watanabe", code: "W004", hours: "142.0", prev: "103.0", change: "+38%", review: true },
    { name: "Tomás Ortega", code: "W006", hours: "84.0", prev: "80.0", change: "+5%", review: false },
    { name: "Mei Lin", code: "W009", hours: "64.0", prev: "64.0", change: "0%", review: false },
    { name: "Amara Diallo", code: "W011", hours: "88.0", prev: "86.0", change: "+2%", review: false },
  ];
  const th = cn("h-9 border-b px-2.5 text-left font-medium text-muted-foreground", hair);
  const td = cn("h-10 border-b px-2.5", hair);
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13)}>
      <p className={cn("flex items-center justify-between gap-3 border-b px-3.5 py-2.5 font-medium", hair)}>
        oct-2026-timesheets.csv
        <span className="font-normal text-muted-foreground">compared with September</span>
      </p>
      <table className={cn("w-full border-separate border-spacing-0", num)}>
        <thead>
          <tr>
            <th scope="col" className={cn(th, "pl-3.5")}>Worker</th>
            <th scope="col" className={cn(th, "text-right")}>Hours</th>
            <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>September</th>
            <th scope="col" className={cn(th, "pr-3.5")}>Check</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className={r.review ? "bg-signal/[0.04]" : undefined}>
              <th scope="row" className={cn(td, "py-1.5 pl-3.5 text-left font-normal")}><Person name={r.name} code={r.code} /></th>
              <td className={cn(td, "text-right")}>{r.hours}</td>
              <td className={cn(td, "hidden text-right sm:table-cell")}>{r.prev}</td>
              <td className={cn(td, "pr-3.5")}>
                {r.review ? <Status kind="review">{r.change} · Needs review</Status> : <span className="text-muted-foreground">{r.change} · Matches</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3.5 py-2.5 text-muted-foreground">Pay policy v3 §6 asks for review above a 25% change.</p>
    </div>
  );
}

/** Bento B: a payout wallet changed before payday, held out of the plan (mockups/payroll-payments.html). */
export function WalletChangeVisual() {
  return (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-[0.5rem] bg-white px-4 py-3 text-foreground", text13, num)}>
      <Person name="Noah Kim" code="W014" />
      <span className="text-right font-medium">$7,800.00</span>
      <span className="text-muted-foreground">
        Payout wallet ends <span className="font-mono text-foreground">e07D</span> · <span className="text-signal">changed Oct 6</span>
      </span>
      <span className="inline-flex items-center gap-[5px] justify-self-end rounded-[0.25rem] bg-signal px-[7px] font-medium leading-5 text-white">
        <CirclePause aria-hidden className="size-3.5" strokeWidth={2.25} />
        Hold · DO NOT PAY
      </span>
    </div>
  );
}

const policyRows = [
  ["Salary", "One twelfth of annual salary each month", "Benefits §1.2"],
  ["Overtime, salaried staff", "1.5 × hourly equivalent in release weeks", "Platform rules §3"],
  ["Home office stipend", "$150 a month, full-time employees", "Benefits §3.1"],
];

/** Bento C and proof card: pay settings with the policy clause each one comes from (mockups/payroll-calculation.html). */
export function PolicyRuleVisual({ compact = false }: { compact?: boolean }) {
  const rows = compact ? policyRows.slice(1, 3) : policyRows;
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13)}>
      <ul>
        {rows.map(([setting, used, source]) => (
          <li key={setting} className={cn("grid gap-1 border-b px-3.5 py-2.5", hair, !compact && "sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-3")}>
            <span className="font-medium">{setting}</span>
            <span><span className="text-muted-foreground">Used: </span>{used}</span>
            <span><Tag tone="gray">{source}</Tag></span>
          </li>
        ))}
      </ul>
      <p className="px-3.5 py-2.5 text-muted-foreground">Pay policy v3 · approved Sep 28 by Maya Reyes</p>
    </div>
  );
}

const traceSteps = [
  { n: 4, label: "Base salary", value: "$6,500.00", how: "Annual salary $78,000.00 ÷ 12", source: "Agreement §3.1" },
  { n: 6, label: "Release-week overtime", value: "$332.39", how: "6 h × hourly equivalent × 1.5", source: "Platform rules §3" },
  { n: 7, label: "Home office stipend", value: "$150.00", how: "Flat monthly amount", source: "Benefits §3.1" },
  { n: 8, label: "Wages", value: "$6,982.39", how: "$6,500.00 + $332.39 + $150.00", source: null },
];

/** Bento D and proof card: calculation steps in the order they ran (mockups/payroll-calculation.html, Daniel Okafor W008). */
export function TraceVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13, num)}>
      {!compact && (
        <p className={cn("flex items-center justify-between gap-3 border-b px-3.5 py-2.5", hair)}>
          <Person name="Daniel Okafor" code="W008" />
          <span className="text-muted-foreground">Salaried · Engineering</span>
        </p>
      )}
      <ol>
        {traceSteps.map((s) => (
          <li key={s.n} className={cn("grid grid-cols-[1.5rem_1fr_auto] gap-x-2 border-b px-3.5 py-2.5 last:border-b-0", hair, s.label === "Wages" && "bg-foreground/[0.03] font-medium")}>
            <span className="text-muted-foreground">{s.n}</span>
            <span className="min-w-0">
              {s.label}
              {!compact && (
                <span className="mt-0.5 block font-normal text-muted-foreground">
                  {s.how}
                  {s.source && <> · {s.source}</>}
                </span>
              )}
            </span>
            <span className="text-right">{s.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Proof card: the import check before upload (mockups/payroll-import.html). */
export function ImportVisual() {
  const stats = [
    ["Rows in file", "42", "Header row not counted"],
    ["Valid", "40", "Ready to import"],
    ["Rejected", "2", "Skipped, with reasons"],
    ["Duplicates", "0", "Same worker, date and hours"],
  ];
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13, num)}>
      <ul className="grid grid-cols-2 sm:grid-cols-4">
        {stats.map(([k, v, hint]) => (
          <li key={k} className={cn("border-b border-r px-3.5 py-3", hair)}>
            <p className="text-muted-foreground">{k}</p>
            <p className="mt-0.5 text-lg font-medium">{v}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </li>
        ))}
      </ul>
      <p className="px-3.5 py-2.5 text-muted-foreground">
        Names stay on this computer. Kleeno receives <span className="text-foreground">W004</span>, never “Kenji Watanabe”.
      </p>
    </div>
  );
}

/** Proof card: payroll approval and plan signing by two different people (mockups/payroll-payments.html). */
export function ApprovalsVisual() {
  const rows = [
    { step: "Payroll approval", who: "Leo Hart", role: "HR approver", when: "Approved Oct 8" },
    { step: "Payment plan", who: "Sam Ortiz", role: "Payment approver", when: "Signed Oct 8" },
  ];
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13)}>
      <ul>
        {rows.map((r) => (
          <li key={r.step} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3.5 py-2.5", hair)}>
            <span>
              <span className="font-medium">{r.step}</span>
              <span className="ml-2 text-muted-foreground">
                {r.who} · {r.role}
              </span>
            </span>
            <Status kind="ok">{r.when}</Status>
          </li>
        ))}
      </ul>
      <p className="px-3.5 py-2.5 text-muted-foreground">Different people, each re-entering their password. 12 payments ready · $64,912.00 · 1 on hold</p>
    </div>
  );
}

/** Proof card: the worker's payment receipt (mockups/receipt.html). No name on a receipt by design. */
export function ReceiptVisual() {
  return (
    <div className={cn("overflow-hidden rounded-[0.5rem] border bg-white", hair, text13, num)}>
      <div className="px-3.5 pt-3.5">
        <p className="text-muted-foreground">You received</p>
        <p className="mt-0.5 text-2xl font-medium tracking-tight">$6,390.00 USDC</p>
        <p className="text-muted-foreground">from Northwind Remote</p>
        <p className="mt-2"><Status kind="ok">Settled · verified</Status></p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 px-3.5 sm:grid-cols-4">
        {[
          ["Date", "Sep 30, 2026"],
          ["Network", "Arc testnet"],
          ["Asset", "USDC"],
          ["Transaction", "0x7a3f…c91e"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("font-medium", k === "Transaction" && "font-mono")}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={cn("mt-3 border-t px-3.5 py-2.5 text-muted-foreground", hair)}>Arc testnet USDC, no real funds</p>
    </div>
  );
}

/** Small pill-shaped renderings that sit inline inside a heading (gpt-taste inline typography images). */
export function InlinePill({ variant }: { variant: "signers" | "trace" }) {
  return (
    <span aria-hidden className="mx-[0.15em] inline-flex h-[0.78em] w-[1.9em] -translate-y-[0.06em] items-center justify-center gap-[0.12em] overflow-hidden rounded-[0.375rem] bg-primary align-middle">
      {variant === "signers" ? (
        <>
          <span className="size-[0.32em] rounded-[0.1em] bg-background" />
          <span className="size-[0.32em] rounded-[0.1em] bg-background/50" />
        </>
      ) : (
        <span className="flex w-[1.2em] flex-col gap-[0.07em]">
          <span className="h-[0.06em] w-full rounded-[0.03em] bg-background/80" />
          <span className="h-[0.06em] w-3/4 rounded-[0.03em] bg-background/60" />
          <span className="h-[0.06em] w-1/2 rounded-[0.03em] bg-background/40" />
        </span>
      )}
    </span>
  );
}
