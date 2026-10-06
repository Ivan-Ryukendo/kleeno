import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { MfaSetup, PasswordForm } from "@/components/account-forms";
import { StatusPill } from "@/components/status-pill";
import { ROLE_LABELS } from "@/core/tenancy";
import { linkedMethods } from "@/server/auth/oauth";
import { pageSession } from "@/server/auth/page-session";

export const metadata = { title: "Account · Kleeno" };

export default async function AccountPage() {
  await connection();
  const session = await pageSession({ allowAal1: true });
  const { actor, client } = session; // a password-only user must be able to reach MFA setup
  const factors = (await client.auth.mfa.listFactors()).data?.totp ?? [];
  const company = session.companies.find((c) => c.companyId === actor.companyId); // not read through RLS: it hides the company until the second step is done
  const needsMfa = actor.mfaRequired && actor.aal !== "aal2";
  const { data: userData } = await client.auth.getUser();
  const linked = userData.user ? linkedMethods(userData.user) : [];

  return (
    <>
      <PageHeader title="Account" description="Your sign-in, roles and security." />

      <section className="mt-6 panel">
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

      <section className="mt-6 panel">
        <h2 className="text-lg">Sign-in methods</h2>
        <p className="mt-2 text-muted-foreground">Google links automatically when you sign in with a Google account that uses this email.</p>
        <ul className="mt-4 divide-y divide-border">
          {(
            [
              ["password", "Password"],
              ["google", "Google"],
            ] as const
          ).map(([method, label]) => (
            <li key={method} className="flex items-center justify-between gap-3 py-2.5">
              <span>{label}</span>
              <span className={linked.includes(method) ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{linked.includes(method) ? "Connected" : "Not connected"}</span>
            </li>
          ))}
        </ul>
      </section>

      {factors.length === 0 && (
        <section className="mt-6 panel">
          <h2 className="text-lg">Multi-factor sign-in</h2>
          <p className="mt-2 text-muted-foreground">A code from an app on your phone, in addition to your password. Required for real companies.</p>
          <MfaSetup />
        </section>
      )}

      <section className="mt-6 panel">
        <h2 className="text-lg">Change password</h2>
        <PasswordForm />
      </section>
    </>
  );
}
