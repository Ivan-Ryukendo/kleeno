import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { ConfigCard, PolicyForm, type ConfigCardView } from "@/components/config-forms";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { listConfigs, type ConfigView } from "@/server/db/configs";

export const metadata = { title: "Configuration · Kleeno" };

const view = (c: ConfigView): ConfigCardView => {
  const p = c.params;
  const text = new Map(c.clauses.map((cl) => [cl.id, cl.text]));
  return {
    id: c.id,
    version: c.version,
    status: c.status,
    aiAssisted: c.aiAssisted,
    flags: c.flags,
    confirmed: c.confirmed,
    values: [
      { label: "Scheduled hours per period", value: p.scheduledHoursPerPeriod },
      { label: "Weekly overtime starts after (hours)", value: p.weeklyOvertimeThresholdHours },
      { label: "Overtime multiplier", value: `${p.overtimeMultiplier}×` },
      { label: "Hourly cap (hours)", value: p.hourlyCapHours ?? "none" },
      { label: "Above-cap multiplier", value: `${p.aboveCapMultiplier}×` },
      ...p.deductions.map((d) => ({ label: d.label, value: `${d.percent}% of gross` })),
      { label: "Variance tolerance", value: p.varianceTolerance },
    ],
    rules: p.rules.map((r) => ({ ruleId: r.ruleId, clauses: r.clauseIds.map((id) => ({ id, text: text.get(id) ?? "" })) })),
  };
};

export default async function ConfigurationPage() {
  await connection();
  const { actor, client } = await pageSession();
  const configs = (await listConfigs(client, actor.companyId)).map(view);
  const canEdit = isPayrollRole(actor.role);

  return (
    <>
      <AppNav />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Configuration
        </p>
        <h1 className="mt-4 text-5xl">How you pay</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Describe your policy in plain words. The AI proposes rules and shows which line each one comes from. Nothing applies until you approve a version; approved versions never change.</p>

        {canEdit && (
          <section className="mt-10 rounded-[2.5rem] bg-card p-10 shadow-card">
            <h2 className="text-2xl">New proposal</h2>
            <PolicyForm />
          </section>
        )}

        {configs.length === 0 ? <p className="mt-10 text-muted-foreground">No configuration yet. {canEdit ? "Describe your policy above." : "The payroll approver adds one."}</p> : configs.map((c) => <ConfigCard key={c.id} c={c} canEdit={canEdit} />)}
      </main>
    </>
  );
}
