import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { NewRunForm } from "@/components/new-run-form";
import { SetupChecklist } from "@/components/setup-checklist";
import { StatusPill } from "@/components/status-pill";
import { setupChecklist } from "@/core/setup";
import { isOwner } from "@/core/tenancy";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { getCompany, setupFacts } from "@/server/db/company";
import { dashboardView } from "@/server/db/views";

export const metadata = { title: "Home · Kleeno" };

export default async function DashboardPage() {
  await connection();
  const session = await pageSession();
  const { actor, client } = session;
  const [{ company, runs }, profile, facts] = await Promise.all([dashboardView(client, actor.companyId), getCompany(actor.companyId), setupFacts(actor.companyId)]);
  if (!profile.onboardedAt && isOwner(actor.roles)) redirect("/onboarding"); // new companies start with the three-step wizard
  const setup = setupChecklist(facts);

  return (
    <>
      <PageHeader title="Home" description={company.name} />

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Live payments</span>
        <StatusPill status={company.live_payments_enabled ? "ON" : "OFF"} />
        <span className="ml-2 text-muted-foreground">Guard</span>
        <span className="rounded-chip border bg-secondary px-2 py-0.5 font-mono text-xs break-all">{company.guard_address ?? "not deployed"}</span>
      </div>

      {setup.done < setup.total && <SetupChecklist items={setup.items} done={setup.done} total={setup.total} />}

      {isPayrollRole(actor.roles) && (
        <section id="start-run" className="mt-6 panel scroll-mt-20">
          <h2 className="text-lg">Start a run</h2>
          <NewRunForm />
        </section>
      )}

      <section id="pay-runs" className="mt-6 panel scroll-mt-20">
        <h2 className="text-lg">Pay runs</h2>
        {runs.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Mode</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/50">
                    <td className="py-2.5 pr-4">
                      <Link href={`/runs/${r.id}`} className="font-medium underline underline-offset-4">
                        {r.period_start} to {r.period_end}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusPill status={r.mode} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
