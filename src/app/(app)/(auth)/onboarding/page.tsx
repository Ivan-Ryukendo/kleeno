import { redirect } from "next/navigation";
import { connection } from "next/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { countryOptions } from "@/core/company";
import { timeZoneChoices } from "@/lib/timezone-display";
import { isOwner } from "@/core/tenancy";
import { pageSession } from "@/server/auth/page-session";
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
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight">Let&apos;s set up {company.profile.name}</h1>
      <p className="mt-2 text-muted-foreground">Three short steps. You can change everything later in Settings.</p>
      <OnboardingWizard profile={company.profile} options={{ countries: countryOptions(), zones: timeZoneChoices() }} mfaRequired={company.mfaRequired} mfaOn={factors.length > 0 && actor.aal === "aal2"} />
    </div>
  );
}
