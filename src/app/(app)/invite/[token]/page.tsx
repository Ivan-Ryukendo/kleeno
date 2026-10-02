import { headers } from "next/headers";
import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { InviteAcceptForm } from "@/components/invite-accept-form";
import { INVALID_INVITE_MESSAGE } from "@/core/invites";
import { ROLE_LABELS } from "@/core/tenancy";
import { allow, keyFromHeaders } from "@/server/db/growth";
import { peekInvite } from "@/server/db/invites";

export const metadata = { title: "Join a company · Kleeno", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// Public page behind a one-time link (S62). A bad, used, expired or revoked link all show the same calm message.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const limited = !(await allow("invite-peek", keyFromHeaders(await headers()), 600, 60));
  const invite = limited ? null : await peekInvite(token);

  return (
    <>
      <AppNav signedIn={false} />
      <main className="mx-auto max-w-lg px-6 py-20">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Invitation
        </p>
        {invite ? (
          <>
            <h1 className="mt-4 text-5xl">Join {invite.companyName}</h1>
            <div className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
              <p className="text-muted-foreground">
                You were invited as <span className="font-medium text-foreground">{invite.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>. This link works once and only for the email below.
              </p>
              <InviteAcceptForm token={token} email={invite.email} existingAccount={invite.existingAccount} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-5xl">Link not valid</h1>
            <div className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
              <p className="text-muted-foreground">{INVALID_INVITE_MESSAGE}</p>
            </div>
          </>
        )}
      </main>
    </>
  );
}
