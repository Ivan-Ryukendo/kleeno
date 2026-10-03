import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigCard, PolicyForm, type ConfigCardView } from "@/components/config-forms";
import { isPayrollRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { listConfigs, type ConfigView } from "@/server/db/configs";

export const metadata = { title: "Pay policy · Kleeno" };

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
  const session = await pageSession();
  const { actor, client } = session;
  const configs = (await listConfigs(client, actor.companyId)).map(view);
  const canEdit = isPayrollRole(actor.roles);

  return (
    <>
      <PageHeader title="Pay policy" description="How you pay. Describe your policy in plain words. The AI proposes rules and shows which line each one comes from. Nothing applies until you approve a version; approved versions never change." />

      {canEdit && (
        <section className="mt-6 panel">
          <h2 className="text-lg">New proposal</h2>
          <PolicyForm />
        </section>
      )}

      {configs.length === 0 ? <p className="mt-6 text-muted-foreground">No configuration yet. {canEdit ? "Describe your policy above." : "The payroll approver adds one."}</p> : configs.map((c) => <ConfigCard key={c.id} c={c} canEdit={canEdit} />)}
    </>
  );
}
