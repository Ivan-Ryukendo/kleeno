import { connection } from "next/server";
import { MfaSetup, PasswordForm } from "@/components/account-forms";
import { AccountCompanies, GoogleUnlinkForm, SignOutOthersButton } from "@/components/account-security-actions";
import { AccountTimezoneForm } from "@/components/account-timezone-form";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsNavigation } from "@/components/settings-navigation";
import { StatusPill } from "@/components/status-pill";
import { ROLE_LABELS } from "@/core/tenancy";
import { timeZoneChoices } from "@/lib/timezone-display";
import { linkedMethods } from "@/server/auth/oauth";
import { pageSession } from "@/server/auth/page-session";

export const metadata = { title: "Account · Kleeno" };

const dateLabel = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
};

export default async function AccountPage() {
  await connection();
  const session = await pageSession({ allowAal1: true });
  const { actor, client } = session; // A password-only user can still reach MFA setup.
  const [factorResult, userResult] = await Promise.all([client.auth.mfa.listFactors(), client.auth.getUser()]);
  const factors = factorResult.data?.totp ?? [];
  const user = !userResult.error && userResult.data.user?.id === actor.userId ? userResult.data.user : null;
  const company = session.companies.find((c) => c.companyId === actor.companyId);
  const needsMfa = actor.mfaRequired && actor.aal !== "aal2";
  const securityActionsReady = actor.aal === "aal2" || (!actor.mfaRequired && factors.length === 0);
  const linked = user ? linkedMethods(user) : [];
  const googleIdentity = user?.identities?.find((identity) => identity.provider === "google") ?? null;
  const joined = dateLabel(user?.created_at);
  const googleLinked = dateLabel(googleIdentity?.created_at);

  return (
    <>
      <PageHeader title="Account" description="Your sign-in, companies and security." />
      <SettingsNavigation roles={actor.roles} current="/account" nav={!needsMfa}>
        <section className="panel" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-lg">Profile</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="break-all">{user?.email ?? "Not available"}</span>
              <StatusPill status={user?.email_confirmed_at ? "Verified" : "Not verified"} />
            </dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{joined ? `Joined Kleeno on ${joined}` : "Join date not available"}</dd>
            <dt className="text-muted-foreground">Current company</dt>
            <dd>{company?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Roles</dt>
            <dd className="flex flex-wrap gap-2">
              {actor.roles.map((role) => <StatusPill key={role} status={ROLE_LABELS[role]} />)}
            </dd>
            <dt className="text-muted-foreground">Multi-factor sign-in</dt>
            <dd>{factors.length > 0 ? "On" : actor.mfaRequired ? "Required for your company" : "Off"}</dd>
          </dl>
          {needsMfa && factors.length > 0 && <p className="mt-5 font-medium text-signal">Sign in again with your authenticator code to unlock company actions.</p>}
        </section>

        <section className="mt-6 panel" aria-labelledby="companies-heading">
          <h2 id="companies-heading" className="text-lg">Your companies and roles</h2>
          <p className="mt-2 text-sm text-muted-foreground">Roles apply to each company separately. The server checks access when you switch.</p>
          <AccountCompanies enabled={securityActionsReady} companies={session.companies.map((membership) => ({
            id: membership.companyId,
            name: membership.name,
            roles: membership.roles.map((role) => ROLE_LABELS[role]),
            current: membership.companyId === actor.companyId,
          }))} />
        </section>

        <section className="mt-6 panel" aria-labelledby="methods-heading">
          <h2 id="methods-heading" className="text-lg">Sign-in methods</h2>
          <p className="mt-2 text-sm text-muted-foreground">Google sign-in is available only to existing accounts.</p>
          <ul className="mt-4 divide-y divide-border">
            <li className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Password</p>
                <p className="mt-1 text-sm text-muted-foreground">{linked.includes("password") ? "Connected" : "Not connected"}</p>
              </div>
            </li>
            <li className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Google</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {linked.includes("google") ? `Connected${googleLinked ? ` · linked ${googleLinked}` : ""}` : "Not connected"}
                </p>
              </div>
              {googleIdentity && <GoogleUnlinkForm enabled={securityActionsReady} hasPasswordMethod={linked.includes("password")} />}
            </li>
          </ul>
        </section>

        <section className="mt-6 panel" aria-labelledby="other-sessions-heading">
          <h2 id="other-sessions-heading" className="text-lg">Other sessions</h2>
          <SignOutOthersButton enabled={securityActionsReady} />
        </section>

        <section className="mt-6 panel" aria-labelledby="timezone-heading">
          <h2 id="timezone-heading" className="text-lg">Time zone</h2>
          <p className="mt-2 text-muted-foreground">Deadlines and run times show in this zone in every company you belong to.</p>
          <AccountTimezoneForm options={timeZoneChoices()} />
        </section>

        {factors.length === 0 && (
          <section className="mt-6 panel" aria-labelledby="mfa-heading">
            <h2 id="mfa-heading" className="text-lg">Multi-factor sign-in</h2>
            <p className="mt-2 text-muted-foreground">A code from an app on your phone, in addition to your password. Required for real companies.</p>
            <MfaSetup />
          </section>
        )}

        <section className="mt-6 panel" aria-labelledby="password-heading">
          <h2 id="password-heading" className="text-lg">Change password</h2>
          <PasswordForm />
        </section>
      </SettingsNavigation>
    </>
  );
}
