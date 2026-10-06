import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
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
  if (query.run) {
    const run = await client.from("payroll_runs").select("id").eq("company_id", actor.companyId).eq("id", query.run).maybeSingle();
    if (run.error) throw new Error("audit run read failed");
    if (!run.data) notFound();
  }
  const timeline = await auditView(client, actor.companyId, { runId: query.run, before: query.before, entityType: query.entity });
  const next = new URLSearchParams({ ...(query.run ? { run: query.run } : {}), ...(query.entity ? { entity: query.entity } : {}), ...(timeline.next ? { before: timeline.next } : {}) });
  return <>
    <PageHeader title="Audit" description="The recorded chain from policy and imported evidence to human decisions and verified settlement." actions={<Link className="text-sm underline underline-offset-4" href="/dashboard">Back to Home</Link>} />
    <section className="mt-6 panel">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-lg">{query.run ? "Selected run timeline" : "Company timeline"}</h2><p className="mt-1 text-xs text-muted-foreground">Newest first · References only · UTC</p>{query.run && <Link className="mt-2 inline-block text-sm underline underline-offset-4" href="/audit">Show all company activity</Link>}</div>
        <form action="/audit" className="flex flex-wrap items-end gap-2">{query.run && <input type="hidden" name="run" value={query.run} />}<label className="text-xs text-muted-foreground">Entity<select name="entity" defaultValue={query.entity ?? ""} className="mt-1 block h-10 rounded-field border bg-background px-3 text-sm"><option value="">All entities</option>{types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label><Button variant="outline" type="submit">Filter</Button></form>
      </div>
      {timeline.graphTruncated && <p role="status" className="mt-4 rounded-field border p-3 text-sm text-muted-foreground">This run exceeds the linked-view limit. Use the company timeline to inspect all recorded activity.</p>}
      <AuditTimeline items={timeline.items} empty="No audit events match this view." />
      {timeline.next && <Link className="mt-4 inline-flex min-h-11 items-center rounded-field border px-4 text-sm" href={`/audit?${next}`}>Older events</Link>}
      {query.before && <Link className="ml-4 text-sm underline underline-offset-4" href={`/audit${query.run ? `?run=${query.run}` : ""}`}>Newest events</Link>}
    </section>
  </>;
}
