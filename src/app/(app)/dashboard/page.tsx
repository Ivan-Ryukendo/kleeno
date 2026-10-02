import Link from "next/link";
import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { NewRunForm } from "@/components/new-run-form";
import { StatusPill } from "@/components/status-pill";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { dashboardView } from "@/server/db/views";

export default async function DashboardPage() {
  await connection();
  const { actor, client } = await pageSession();
  const { company, runs } = await dashboardView(client, actor.companyId);

  return (
    <>
      <AppNav />
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

        {isPayrollRole(actor.role) && (
          <section className="mt-12 rounded-[2.5rem] bg-card p-10 shadow-card">
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
