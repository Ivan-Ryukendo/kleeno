import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { BasicsForm, ScheduleForm } from "@/components/company-form";
import { countryOptions, timezoneOptions } from "@/core/company";
import { isOwner } from "@/core/tenancy";
import { pageSession } from "@/server/auth/page-session";
import { getCompany } from "@/server/db/company";

export const metadata = { title: "Company · Kleeno" };

export default async function CompanySettingsPage() {
  await connection();
  const session = await pageSession();
  const { actor } = session;
  const company = await getCompany(actor.companyId);
  const canEdit = isOwner(actor.roles);

  return (
    <>
      <PageHeader title="Company" description={canEdit ? "Details and pay schedule for this company." : "Only an Owner can change these details."} />

      <section className="mt-6 panel">
        <h2 className="mb-4 text-lg">Details</h2>
        <BasicsForm profile={company.profile} options={{ countries: countryOptions(), zones: timezoneOptions() }} disabled={!canEdit} />
      </section>
      <section className="mt-6 panel">
        <h2 className="mb-4 text-lg">Pay schedule</h2>
        <ScheduleForm profile={company.profile} disabled={!canEdit} />
      </section>
      <section className="mt-6 panel">
        <h2 className="text-lg">Mode</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Live payments</dt>
          <dd>{company.liveEnabled ? "On" : "Off"}</dd>
          <dt className="text-muted-foreground">Kind of company</dt>
          <dd>{company.isDemo ? "Demo" : company.isSandbox ? "Sandbox (simulation only)" : "Standard"}</dd>
          <dt className="text-muted-foreground">Currency</dt>
          <dd>USD (USDC on Arc testnet)</dd>
        </dl>
      </section>
    </>
  );
}
