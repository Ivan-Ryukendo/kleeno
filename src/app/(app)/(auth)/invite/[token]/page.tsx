import { Clock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { InviteAcceptForm } from "@/components/invite-accept-form";
import { ROLE_LABELS } from "@/core/tenancy";
import { ROLE_NOTES } from "@/lib/role-notes";
import { allow, keyFromHeaders } from "@/server/db/growth";
import { peekInvite } from "@/server/db/invites";

export const metadata = { title: "Join a company · Kleeno", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// Public page behind a one-time link (S62). A bad, used, expired or revoked link all show the same calm message.
// mockups/invite.html shows who invited you and when; the invite record keeps neither, so those lines are not shown.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const limited = !(await allow("invite-peek", keyFromHeaders(await headers()), 600, 60));
  const invite = limited ? null : await peekInvite(token);
  const card = "rounded-card border border-border bg-card p-7 max-[520px]:p-5";

  return (
    <div className="mx-auto w-full max-w-[27.5rem]">
      {invite ? (
        <section aria-labelledby="inv-title" className={card}>
          <h1 id="inv-title" className="text-center text-xl font-medium tracking-tight">Join {invite.companyName}</h1>
          <p className="mt-1.5 mb-5 text-center text-muted-foreground">{invite.existingAccount ? "Enter your Kleeno password to accept your invite." : "Create a password to accept your invite."}</p>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{invite.roles.length === 1 ? "Role offered" : "Roles offered"}</span>
            <ul className="m-0 grid list-none gap-2 p-0">
              {invite.roles.map((r) => (
                <li key={r} className="flex gap-2.5 rounded-field border border-border px-3 py-2.5">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="m-0 font-medium">{ROLE_LABELS[r]}</p>
                    <p className="m-0 mt-0.5 text-xs text-muted-foreground">{ROLE_NOTES[r]}</p>
                  </div>
                </li>
              ))}
            </ul>
            <small className="text-xs text-muted-foreground">The Owner can change roles later. You can belong to more than one company with this login. This link works once and only for the email below.</small>
          </div>
          <InviteAcceptForm token={token} email={invite.email} existingAccount={invite.existingAccount} />
        </section>
      ) : (
        <section aria-labelledby="bad-title" className={`${card} text-center`}>
          <div aria-hidden="true" className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-accent text-muted-foreground"><Clock className="size-5" /></div>
          <h1 id="bad-title" className="text-xl font-medium tracking-tight">This invite link can&apos;t be used</h1>
          <p className="mt-1.5 mb-3.5 text-muted-foreground">It may have expired, been used already, or been withdrawn. Nothing was changed.</p>
          <ul className="mb-5 grid list-disc gap-1 pl-5 text-left text-xs text-muted-foreground">
            <li>If you already accepted, sign in with the same email.</li>
            <li>Otherwise ask the person who invited you, or your company Owner, for a new link.</li>
          </ul>
          <Link href="/login" className="inline-flex h-9.5 min-h-11 w-full items-center justify-center rounded-field border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Go to sign in</Link>
        </section>
      )}
    </div>
  );
}
