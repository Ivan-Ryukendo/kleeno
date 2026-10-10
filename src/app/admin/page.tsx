import Link from "next/link";
import { connection } from "next/server";
import { BUDGET_LABELS, BUDGETS, PAIN_LABELS, PAINS, ROLE_LABELS, ROLES, STATUS_LABELS, STATUSES, leadMetrics } from "@/core/growth";
import { AdminSignOut, LiveRequestActions } from "@/components/admin-forms";
import { adminPageSession } from "@/server/auth/admin";
import { PAGE_SIZE, listContacts, metricRows, type ContactFilter } from "@/server/db/growth";
import { liveRequests } from "@/server/db/settlement";
import { loadPlatformAccounts } from "@/server/db/platform-accounts";
import type { PlatformAccounts } from "@/core/growth/accounts";

type Search = Record<string, string | string[] | undefined>;

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const control = "h-11 rounded-full border border-primary/50 bg-white px-4 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

/** Only allow-listed filter values reach the query; anything else is ignored. */
function filterFrom(sp: Search): ContactFilter {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const pick = <T extends string>(k: string, allowed: readonly T[]) => (allowed.includes(one(k) as T) ? (one(k) as T) : undefined);
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(one(k) ?? "") ? one(k) : undefined);
  return {
    q: one("q")?.slice(0, 100),
    status: pick("status", STATUSES),
    role: pick("role", ROLES),
    pain: pick("pain", PAINS),
    budget: pick("budget", BUDGETS),
    call: pick("call", ["yes", "no"] as const),
    source: one("source")?.slice(0, 100),
    from: day("from"),
    to: day("to"),
    page: Math.max(0, Number.parseInt(one("page") ?? "0", 10) || 0),
  };
}

function Bars({ title, note, data }: { title: string; note: string; data: [string, number][] }) {
  const max = Math.max(1, ...data.map(([, n]) => n));
  return (
    <section className="rounded-[2.5rem] bg-card p-8">
      <h2 className="text-xl font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      <dl className="mt-5 space-y-3">
        {data.map(([label, n]) => (
          <div key={label}>
            <div className="flex justify-between gap-4 text-sm">
              <dt>{label}</dt>
              <dd className="font-medium tabular-nums">{n}</dd>
            </div>
            <div aria-hidden className="mt-1 h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AccountInventory({ inventory }: { inventory: PlatformAccounts }) {
  const facts = [
    { label: "Registered accounts", value: inventory.accounts.registered, note: "Login accounts, including accounts without an active company membership" },
    { label: "Companies", value: inventory.companies.total, note: "All currently stored companies; not a count of paying customers" },
    { label: "Active memberships", value: inventory.memberships.active, note: "Company access records; one account can have several memberships" },
    { label: "Worker records", value: inventory.workers.total, note: "Pseudonymous payroll records, not registered login accounts" },
    { label: "Pending invitations", value: inventory.invitations.pending, note: "Unused invitations that have not expired or been revoked" },
  ];
  const cohorts: { label: string; rows: [string, number][] }[] = [
    { label: "Account memberships", rows: [["Accounts with active membership", inventory.accounts.withActiveMembership], ["Accounts with only demo/sandbox memberships", inventory.accounts.onlyDemoSandboxMemberships], ["Accounts with unmarked company memberships", inventory.accounts.unmarkedMemberships], ["Accounts without active membership", inventory.accounts.withoutActiveMembership]] },
    { label: "Company cohorts", rows: [["Demo companies", inventory.companies.demo], ["Sandbox companies", inventory.companies.sandbox], ["Demo or sandbox companies", inventory.companies.demoOrSandbox], ["Unmarked companies", inventory.companies.unmarked]] },
    { label: "Membership records", rows: [["Total memberships", inventory.memberships.total], ["Active memberships", inventory.memberships.active], ["Removed memberships", inventory.memberships.removed]] },
    { label: "Worker cohorts", rows: [["Workers in demo/sandbox companies", inventory.workers.inDemoOrSandboxCompanies], ["Workers in unmarked companies", inventory.workers.inUnmarkedCompanies]] },
    { label: "Invitation records", rows: [["Total invitations", inventory.invitations.total], ["Pending", inventory.invitations.pending], ["Expired", inventory.invitations.expired], ["Used", inventory.invitations.used], ["Revoked", inventory.invitations.revoked]] },
    { label: "Lead records", rows: [["Total lead records", inventory.leads.total], ["Marked test leads", inventory.leads.markedTest], ["Unmarked lead records", inventory.leads.unmarked]] },
  ];
  return <section aria-labelledby="accounts-title" className="mt-10 min-w-0">
    <h2 id="accounts-title" className="text-2xl font-medium">Account inventory</h2>
    <p className="mt-2 text-sm text-muted-foreground">Current database inventory as of <time dateTime={inventory.asOf}>{inventory.asOf}</time>. Lead date filters below do not filter these totals.</p>
    <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{facts.map(fact => <div key={fact.label} className="min-w-0 rounded-[2.5rem] bg-card p-6"><dt className="text-sm text-muted-foreground">{fact.label}</dt><dd className="mt-2 text-4xl font-medium tabular-nums tracking-tight">{fact.value}</dd><p className="mt-2 text-xs text-muted-foreground">{fact.note}</p></div>)}</dl>
    <p className="mt-4 text-sm font-medium">Test exclusions are incomplete. Account and company test classification is unknown. Unmarked does not mean non-test or paying.</p>
    <details className="mt-4 rounded-[2.5rem] bg-card p-6">
      <summary className="min-h-11 cursor-pointer rounded-[1.25rem] py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Inventory cohorts and exclusions</summary>
      <p className="mt-2 text-sm text-muted-foreground">Demo and sandbox flags can overlap. The combined count avoids double-counting. Accounts with any unmarked active company are counted separately from accounts with only demo/sandbox memberships.</p>
      <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{cohorts.map(cohort => <div key={cohort.label} className="min-w-0"><h3 className="font-medium">{cohort.label}</h3><dl className="mt-3 divide-y divide-border">{cohort.rows.map(([label, count]) => <div key={label} className="flex justify-between gap-4 py-2 text-sm"><dt className="min-w-0 break-words text-muted-foreground">{label}</dt><dd className="shrink-0 font-medium tabular-nums">{count}</dd></div>)}</dl></div>)}</div>
    </details>
    <div className="mt-4 rounded-[2.5rem] bg-card p-6"><h3 className="text-lg font-medium">Commercial measurements</h3><p className="mt-2 text-sm text-muted-foreground">These outcomes cannot be inferred from account, membership, worker or lead totals.</p><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{["Paid companies", "Trials", "Subscriptions", "Activated reviewers"].map(label => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">Unavailable</dd></div>)}</dl></div>
  </section>;
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const { base, admin } = await adminPageSession();
  const f = filterFrom(await searchParams);
  const [m, { rows, total }, live, inventory] = await Promise.all([metricRows().then(leadMetrics), listContacts(f), liveRequests(), loadPlatformAccounts(admin).catch(() => null)]);
  const filtered = Object.entries(f).some(([k, v]) => k !== "page" && v);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...f, page: p ? String(p) : undefined }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
    return `${base}?${q}`;
  };

  const tiles = [
    { label: "Waitlist leads", value: String(m.signups), note: "Contacts not marked as tests; not registered app accounts" },
    { label: "Survey completion", value: pct(m.surveyRate), note: `${m.surveyed} with answers ÷ ${m.signups} waitlist leads` },
    { label: "Open to a call", value: String(m.wantsCall), note: `${pct(m.wantsCallRate)} of waitlist leads said yes` },
    { label: "Calls", value: `${m.byStatus.CALL_SCHEDULED} / ${m.byStatus.CALL_DONE}`, note: "Scheduled / done (current status)" },
    { label: "Pilot candidates", value: String(m.byStatus.PILOT_CANDIDATE), note: `Call → pilot: ${pct(m.callToPilot)} (pilots ÷ (call done + pilots))` },
  ];

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.04em]">
            <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
            Team only
          </p>
          <h1 className="mt-2 text-4xl font-medium tracking-[-0.02em]">Accounts and leads</h1>
        </div>
        <div className="flex gap-3">
          <a href={`${base}/api/export`} className="inline-flex h-11 items-center rounded-[1.25rem] bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/85">
            Export CSV
          </a>
          <Link href={`${base}/support`} className="inline-flex min-h-11 items-center rounded-[1.25rem] border px-6 text-sm">Support</Link>
          <Link href={`${base}/billing`} className="inline-flex min-h-11 items-center rounded-[1.25rem] border px-6 text-sm">Billing and demos</Link>
          <AdminSignOut base={base} />
        </div>
      </header>

      {inventory ? <AccountInventory inventory={inventory} /> : <section className="mt-10 rounded-[2.5rem] bg-card p-8"><h2 className="text-2xl font-medium">Account inventory unavailable</h2><p role="alert" className="mt-3 text-sm text-signal">Account inventory could not be loaded. No account or company count is inferred.</p><Link href={base} className="mt-3 inline-flex min-h-11 items-center rounded-[1.25rem] text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Reload account inventory</Link></section>}

      <section aria-labelledby="live-title" className="mt-10">
        <h2 id="live-title" className="text-2xl font-medium">Live-payment requests</h2>
        {live.length === 0 ? (
          <p className="mt-3 rounded-[2.5rem] bg-card p-8 text-muted-foreground">No company has asked for live payments yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-[1.25rem] bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border">
                <tr>
                  {["Company", "Status", "Requested", "Guard", "Action"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {live.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">{c.live_status.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="whitespace-nowrap px-4 py-3">{c.live_requested_at ? date(c.live_requested_at) : "–"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.guard_address ? `${c.guard_address.slice(0, 10)}…${c.guard_address.slice(-6)}` : "–"}</td>
                    <td className="px-4 py-3 text-right"><LiveRequestActions base={base} companyId={c.id} status={c.live_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {m.signups === 0 ? (
        <p className="mt-10 rounded-[2.5rem] bg-card p-10 text-lg">No waitlist leads yet. These lead metrics exclude records marked as tests and do not count registered app accounts.</p>
      ) : (
        <>
          <section aria-label="Key numbers" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-[2.5rem] bg-card p-6">
                <p className="text-sm text-muted-foreground">{t.label}</p>
                <p className="mt-2 text-4xl font-medium tabular-nums tracking-tight">{t.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t.note}</p>
              </div>
            ))}
          </section>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Bars title="Biggest challenge" note={`Of ${m.surveyed} surveyed contacts`} data={PAINS.map((k) => [PAIN_LABELS[k], m.pains[k]])} />
            <Bars title="Stated monthly budget" note="Research answers, not commitments" data={BUDGETS.map((k) => [BUDGET_LABELS[k], m.budgets[k]])} />
            <Bars title="Where waitlist leads came from" note="utm_source, else referring site, else direct" data={m.sources.slice(0, 8)} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Visitor counts live in Vercel Web Analytics. Waitlist conversion = waitlist leads ÷ unique visitors for the same period; this does not measure app activation.</p>
        </>
      )}

      <section aria-labelledby="contacts-title" className="mt-14">
        <h2 id="contacts-title" className="text-2xl font-medium">Contacts</h2>
        <form method="get" action={base} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block">Search</span>
            <input name="q" defaultValue={f.q} placeholder="Email or company" className={`${control} w-56`} />
          </label>
          {(
            [
              ["status", "Status", STATUSES, STATUS_LABELS],
              ["role", "Role", ROLES, ROLE_LABELS],
              ["pain", "Challenge", PAINS, PAIN_LABELS],
              ["budget", "Budget", BUDGETS, BUDGET_LABELS],
            ] as const
          ).map(([name, label, keys, labels]) => (
            <label key={name} className="text-sm">
              <span className="mb-1 block">{label}</span>
              <select name={name} defaultValue={(f as Record<string, string | undefined>)[name] ?? ""} className={`${control} max-w-48`}>
                <option value="">Any</option>
                {keys.map((k) => (
                  <option key={k} value={k}>{(labels as Record<string, string>)[k]}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block">Call</span>
            <select name="call" defaultValue={f.call ?? ""} className={control}>
              <option value="">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block">Source</span>
            <input name="source" defaultValue={f.source} placeholder="e.g. linkedin" className={`${control} w-36`} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block">From</span>
            <input type="date" name="from" defaultValue={f.from} className={control} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block">To</span>
            <input type="date" name="to" defaultValue={f.to} className={control} />
          </label>
          <button type="submit" className="inline-flex h-11 items-center rounded-[1.25rem] bg-primary px-6 text-sm font-medium text-primary-foreground">Filter</button>
          {filtered && (
            <Link href={base} className="inline-flex h-11 items-center px-2 text-sm underline underline-offset-4">Clear</Link>
          )}
        </form>

        <div className="mt-6 overflow-x-auto rounded-[1.25rem] bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Waitlist contacts, newest first</caption>
            <thead className="border-b border-border">
              <tr>
                {["Joined", "Email", "Company", "Role", "Challenge", "Budget", "Call", "Status", "Next action"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">{filtered ? "No contacts match these filters." : "No contacts yet."}</td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/60">
                  <td className="whitespace-nowrap px-4 py-3">{date(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`${base}/contacts/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.email}</Link>
                    {c.is_test && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">test</span>}
                  </td>
                  <td className="px-4 py-3">{c.company_name ?? "–"}</td>
                  <td className="px-4 py-3">{c.role ? ROLE_LABELS[c.role as keyof typeof ROLE_LABELS] : "–"}</td>
                  <td className="px-4 py-3">{c.surveys?.pain_point ? PAIN_LABELS[c.surveys.pain_point as keyof typeof PAIN_LABELS] : "–"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{c.surveys?.budget_band ? BUDGET_LABELS[c.surveys.budget_band as keyof typeof BUDGET_LABELS] : "–"}</td>
                  <td className="px-4 py-3">{c.surveys?.wants_call == null ? "–" : c.surveys.wants_call ? "Yes" : "No"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{STATUS_LABELS[c.status as keyof typeof STATUS_LABELS]}</td>
                  <td className="whitespace-nowrap px-4 py-3">{c.next_action_at ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
          <span>
            {total} contact{total === 1 ? "" : "s"} · page {(f.page ?? 0) + 1} of {pages}
          </span>
          <span className="flex gap-3">
            {(f.page ?? 0) > 0 && <Link href={pageHref((f.page ?? 0) - 1)} className="underline underline-offset-4">Previous</Link>}
            {(f.page ?? 0) + 1 < pages && <Link href={pageHref((f.page ?? 0) + 1)} className="underline underline-offset-4">Next</Link>}
          </span>
        </nav>
      </section>
    </main>
  );
}
