import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsNavigation } from "@/components/settings-navigation";
import { StatusPill } from "@/components/status-pill";
import { InviteForm, MemberActions, RevokeInviteButton } from "@/components/team-forms";
import { ROLE_LABELS, isOwner } from "@/core/tenancy";
import { pageSession } from "@/server/auth/page-session";
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
      <PageHeader title="Team" description="The people who sign in. Workers you pay are managed on the Workers page. The person who approves a payroll run can never also sign its payment." />
      <SettingsNavigation roles={actor.roles} current="/settings/team">
      <section className="mt-6 panel">
        <h2 className="text-lg">Members</h2>
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
          <section className="mt-6 panel">
            <h2 className="mb-4 text-lg">Invite someone</h2>
            <InviteForm />
          </section>
          <section className="mt-6 panel">
            <h2 className="text-lg">Pending invitations</h2>
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
        <p className="mt-6 text-muted-foreground">Only an Owner can invite people or change roles.</p>
      )}
      </SettingsNavigation>
    </>
  );
}
