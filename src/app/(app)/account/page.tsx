import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { MfaSetup, PasswordForm } from "@/components/account-forms";
import { StatusPill } from "@/components/status-pill";
import { ROLE_LABELS } from "@/core/tenancy";
import { navFor, pageSession } from "@/server/auth/page-session";

export const metadata = { title: "Account · Kleeno" };

export default async function AccountPage() {
  await connection();
  const session = await pageSession({ allowAal1: true });
  const { actor, client } = session; // a password-only user must be able to reach MFA setup
  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? [];
  const company = session.companies.find((c) => c.companyId === actor.companyId); // not read through RLS: it hides the company until the second step is done
  const needsMfa = actor.mfaRequired && actor.aal !== "aal2";

  return (
    <>
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Account
        </p>
        <h1 className="mt-4 text-5xl">Your account</h1>

        <section className="mt-10 rounded-[2.5rem] bg-card p-10 shadow-card">
          <dl className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{actor.email}</dd>
            <dt className="text-muted-foreground">Company</dt>
            <dd>{company?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Roles</dt>
            <dd className="flex flex-wrap gap-2">
              {actor.roles.map((r) => (
                <StatusPill key={r} status={ROLE_LABELS[r]} />
              ))}
            </dd>
            {session.companies.length > 1 && (
              <>
                <dt className="text-muted-foreground">All my companies</dt>
                <dd>
                  <ul className="space-y-1">
                    {session.companies.map((c) => (
                      <li key={c.companyId}>
                        {c.name} <span className="text-sm text-muted-foreground">· {c.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Multi-factor sign-in</dt>
            <dd>{factors.length > 0 ? "On" : actor.mfaRequired ? "Required for your company: set it up below" : "Off"}</dd>
          </dl>
          {needsMfa && factors.length > 0 && <p className="mt-6 font-medium text-signal">Sign in again with your authenticator code to unlock your company data.</p>}
        </section>

        {factors.length === 0 && (
          <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
            <h2 className="text-2xl">Multi-factor sign-in</h2>
            <p className="mt-2 text-muted-foreground">A code from an app on your phone, in addition to your password. Required for real companies.</p>
            <MfaSetup />
          </section>
        )}

        <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="text-2xl">Change password</h2>
          <PasswordForm />
        </section>
      </main>
    </>
  );
}
