import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { isOwner } from "@/core/tenancy";
import { navFor, pageSession } from "@/server/auth/page-session";
import { getCompany } from "@/server/db/company";

export const metadata = { title: "Set up your company · Kleeno" };

export default async function OnboardingPage() {
  await connection();
  const session = await pageSession({ allowAal1: true }); // a new Owner has not enrolled the second step yet
  const { actor, client } = session;
  const company = await getCompany(actor.companyId);
  if (!isOwner(actor.roles) || company.onboardedAt) redirect("/dashboard");
  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? [];

  return (
    <>
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Welcome
        </p>
        <h1 className="mt-4 text-5xl">Let&apos;s set up {company.profile.name}</h1>
        <p className="mt-4 text-muted-foreground">Three short steps. You can change everything later in Settings.</p>
        <OnboardingWizard profile={company.profile} mfaRequired={company.mfaRequired} mfaOn={factors.length > 0 && actor.aal === "aal2"} />
      </main>
    </>
  );
}
