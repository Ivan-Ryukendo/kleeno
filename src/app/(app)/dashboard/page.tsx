import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { NewRunForm } from "@/components/new-run-form";
import { SetupChecklist } from "@/components/setup-checklist";
import { StatusPill } from "@/components/status-pill";
import { setupChecklist } from "@/core/setup";
import { isOwner } from "@/core/tenancy";
import { isPayrollRole } from "@/core/workflow";
import { navFor, pageSession } from "@/server/auth/page-session";
import { getCompany, setupFacts } from "@/server/db/company";
import { dashboardView } from "@/server/db/views";

export default async function DashboardPage() {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const [{ company, runs }, profile, facts] = await Promise.all([dashboardView(client, actor.companyId), getCompany(actor.companyId), setupFacts(actor.companyId)]);
  if (!profile.onboardedAt && isOwner(actor.roles)) redirect("/onboarding"); // new companies start with the three-step wizard
  const setup = setupChecklist(facts);

  return (
    <>
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Dashboard
        </p>
        <h1 className="mt-4 text-5xl">{company.name}</h1>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">Live payments</span>
          <StatusPill status={company.live_payments_enabled ? "ON" : "OFF"} />
          <span className="text-muted-foreground">Guard</span>
          <span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs">{company.guard_address ?? "not deployed"}</span>
        </div>

        {setup.done < setup.total && <SetupChecklist items={setup.items} done={setup.done} total={setup.total} />}

        {isPayrollRole(actor.roles) && (
          <section id="start-run" className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
            <h2 className="text-2xl">Start a run</h2>
            <NewRunForm />
          </section>
        )}

        <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="text-2xl">Payroll runs</h2>
          {runs.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="mt-6 divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <Link href={`/runs/${r.id}`} className="font-mono text-sm underline underline-offset-4">
                    {r.id}
                  </Link>
                  <span className="flex items-center gap-3">
                    <StatusPill status={r.mode} />
                    <StatusPill status={r.status} />
                    <span className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
