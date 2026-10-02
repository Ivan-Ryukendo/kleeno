import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { StatusPill } from "@/components/status-pill";
import { InviteForm, MemberActions, RevokeInviteButton } from "@/components/team-forms";
import { ROLE_LABELS, isOwner } from "@/core/tenancy";
import { navFor, pageSession } from "@/server/auth/page-session";
import { listInvites } from "@/server/db/invites";
import { listMembers } from "@/server/db/team";

export const metadata = { title: "Team · Kleeno" };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

export default async function TeamPage() {
  await connection();
  const session = await pageSession();
  const { actor } = session;
  const canEdit = isOwner(actor.roles);
  const [members, invites] = await Promise.all([listMembers(actor.companyId), canEdit ? listInvites(actor.companyId) : Promise.resolve([])]);
  const pending = invites.filter((i) => i.status === "PENDING");

  return (
    <>
      <AppNav {...navFor(session)} />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Settings
        </p>
        <h1 className="mt-4 text-5xl">Team</h1>
        <p className="mt-4 text-muted-foreground">The people who sign in. Workers you pay are managed on the Workers page. The person who approves a payroll run can never also sign its payment.</p>

        <section className="mt-10 rounded-[2.5rem] bg-card p-10 shadow-card">
          <h2 className="text-2xl">Members</h2>
          <ul className="mt-6 divide-y divide-border">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div>
                  <p className="font-medium">{m.email ?? "—"}</p>
                  <p className="mt-1 flex flex-wrap gap-2">
                    {m.roles.map((r) => (
                      <StatusPill key={r} status={ROLE_LABELS[r]} />
                    ))}
                    <span className="text-sm text-muted-foreground">Joined {when(m.joinedAt)}</span>
                  </p>
                </div>
                {canEdit && <MemberActions userId={m.userId} roles={m.roles} isSelf={m.userId === actor.userId} />}
              </li>
            ))}
          </ul>
        </section>

        {canEdit ? (
          <>
            <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
              <h2 className="mb-6 text-2xl">Invite someone</h2>
              <InviteForm />
            </section>
            <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
              <h2 className="text-2xl">Pending invitations</h2>
              {pending.length === 0 ? (
                <p className="mt-4 text-muted-foreground">None.</p>
              ) : (
                <ul className="mt-6 divide-y divide-border">
                  {pending.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div>
                        <p className="font-medium">{i.email}</p>
                        <p className="text-sm text-muted-foreground">
                          {i.roles.map((r) => ROLE_LABELS[r]).join(", ")} · expires {when(i.expiresAt)}
                        </p>
                      </div>
                      <RevokeInviteButton id={i.id} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="mt-8 text-muted-foreground">Only an Owner can invite people or change roles.</p>
        )}
      </main>
    </>
  );
}
