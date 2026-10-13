import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunFrame } from "@/components/payroll/run-frame";
import { loadFrameData } from "@/components/payroll/frame-data";
import { isPayrollRole, isPaymentRole } from "@/core/tenancy";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { AuditTimeline } from "@/components/audit-timeline";
import { Button } from "@/components/ui/button";
import { pageSession } from "@/server/auth/page-session";
import { auditView } from "@/server/db/audit";
import { uuid } from "@/server/schemas";

export const metadata = { title: "Audit · Kleeno" };
const types = ["run", "payroll_runs", "payroll_run", "config", "payroll_configurations", "import_batch", "exceptions", "ai_execution", "payment_batch", "payment_batches", "obligation", "obligations", "worker"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ run?: string; before?: string; entity?: string }> }) {
  await connection();
  const { actor, client } = await pageSession();
  const query = await searchParams;
  if ((query.run && !uuid.safeParse(query.run).success) || (query.before && (query.before.length > 80 || !Number.isFinite(Date.parse(query.before.split("~")[0])) || !uuid.safeParse(query.before.split("~")[1]).success)) || (query.entity && !types.includes(query.entity))) notFound();
  let selected = null;
  if (query.run) {
    const run = await client.from("payroll_runs").select("id, mode, status, period_start, period_end").eq("company_id", actor.companyId).eq("id", query.run).maybeSingle();
    if (run.error) throw new Error("audit run read failed");
    if (!run.data) notFound();
    selected = run.data;
  }
  const frame = selected ? await loadFrameData(client, actor, selected.id) : null;
  const timeline = await auditView(client, actor.companyId, { runId: query.run, before: query.before, entityType: query.entity });
  const filters = new URLSearchParams({ ...(query.run ? { run: query.run } : {}), ...(query.entity ? { entity: query.entity } : {}) });
  const next = new URLSearchParams(filters);
  if (timeline.next) next.set("before", timeline.next);
  const newestHref = `/audit${filters.size ? `?${filters}` : ""}`;
  return <>
    {selected && frame ? <RunFrame run={{ id: selected.id, mode: selected.mode, status: selected.status, periodStart: selected.period_start, periodEnd: selected.period_end }} current="activity" data={frame} canPayroll={isPayrollRole(actor.roles)} canPay={isPaymentRole(actor.roles)} hrefFor={id => `/audit?${new URLSearchParams({ run: id, ...(query.entity ? { entity: query.entity } : {}) })}`} hint="Activity · Recorded evidence, newest first" /> : <PageHeader title="Activity" description="The recorded chain from policy and imported evidence to human decisions and verified settlement." actions={<Link className="inline-flex min-h-11 items-center rounded-field text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={query.run ? `/runs/${query.run}` : "/dashboard"}>{query.run ? "Back to run" : "Back to Dashboard"}</Link>} />}
    {query.run && <Link href={`/runs/${query.run}`} className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Back to run</Link>}
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
    <section className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-lg">{query.run ? "Selected run timeline" : "Company timeline"}</h2><p className="mt-1 text-xs text-muted-foreground">Newest first · References only · UTC</p>{query.run && <Link className="mt-2 inline-block text-sm underline underline-offset-4" href="/audit">Show all company activity</Link>}</div>
        <form action="/audit" className="flex flex-wrap items-end gap-2">{query.run && <input type="hidden" name="run" value={query.run} />}<label className="text-xs text-muted-foreground">Entity<select name="entity" defaultValue={query.entity ?? ""} className="mt-1 block min-h-11 rounded-field border bg-background px-3 text-sm"><option value="">All entities</option>{types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label><Button variant="outline" type="submit">Filter</Button></form>
      </div>
      {timeline.graphTruncated && <p role="status" className="mt-4 rounded-field border p-3 text-sm text-muted-foreground">This run exceeds the linked-view limit. Use the company timeline to inspect all recorded activity.</p>}
      <AuditTimeline items={timeline.items} empty="No audit events match this view." />
      {timeline.next && <Link className="mt-4 inline-flex min-h-11 items-center rounded-field border px-4 text-sm" href={`/audit?${next}`}>Older events</Link>}
      {query.before && <Link className="ml-4 inline-flex min-h-11 items-center rounded-field text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={newestHref}>Newest events</Link>}
    </section>
    <aside className="rounded-card border bg-sidebar p-4" aria-labelledby="activity-evidence-heading"><ShieldCheck aria-hidden="true" className="size-5 text-muted-foreground" /><h2 id="activity-evidence-heading" className="mt-3 text-sm font-medium">A recorded chain of evidence</h2><p className="mt-2 text-sm text-muted-foreground">Imports, checks, human decisions and settlement stay linked to their original records. Open an entry to inspect its evidence and request trace.</p><p className="mt-3 text-xs text-muted-foreground">AI suggestions are labeled. A suggestion is never an approval or proof that money settled. Times shown in UTC.</p></aside>
    </div>
  </>;
}
