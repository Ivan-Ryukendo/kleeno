import { headers } from "next/headers";
import { connection } from "next/server";
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
    <div className="mx-auto w-full max-w-md">
      {invite ? (
        <>
          <h1 className="text-center text-2xl font-medium tracking-tight">Join {invite.companyName}</h1>
          <div className="panel mt-6">
            <p className="text-muted-foreground">
              You were invited as <span className="font-medium text-foreground">{invite.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>. This link works once and only for the email below.
            </p>
            <InviteAcceptForm token={token} email={invite.email} existingAccount={invite.existingAccount} />
          </div>
        </>
      ) : (
        <>
          <h1 className="text-center text-2xl font-medium tracking-tight">Link not valid</h1>
          <div className="panel mt-6">
            <p className="text-muted-foreground">{INVALID_INVITE_MESSAGE}</p>
          </div>
        </>
      )}
    </div>
  );
}
