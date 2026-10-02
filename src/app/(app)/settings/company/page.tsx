import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { BasicsForm, ScheduleForm } from "@/components/company-form";
import { isOwner } from "@/core/tenancy";
import { navFor, pageSession } from "@/server/auth/page-session";
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
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Settings
        </p>
        <h1 className="mt-4 text-5xl">Company</h1>
        {!canEdit && <p className="mt-4 text-muted-foreground">Only an Owner can change these details.</p>}

        <section className="mt-10 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="mb-6 text-2xl">Details</h2>
          <BasicsForm profile={company.profile} disabled={!canEdit} />
        </section>
        <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="mb-6 text-2xl">Pay schedule</h2>
          <ScheduleForm profile={company.profile} disabled={!canEdit} />
        </section>
        <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="text-2xl">Mode</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">Live payments</dt>
            <dd>{company.liveEnabled ? "On" : "Off"}</dd>
            <dt className="text-muted-foreground">Kind of company</dt>
            <dd>{company.isDemo ? "Demo" : company.isSandbox ? "Sandbox (simulation only)" : "Standard"}</dd>
            <dt className="text-muted-foreground">Currency</dt>
            <dd>USD (USDC on Arc testnet)</dd>
          </dl>
        </section>
      </main>
    </>
  );
}
