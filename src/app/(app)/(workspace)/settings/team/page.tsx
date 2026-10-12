import { Lock, Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { connection } from "next/server";
import { Avatar, Chip, Notice, PanelHead } from "@/components/people-ui";
import { SettingsNavigation } from "@/components/settings-navigation";
import { InviteForm, MemberActions, RevokeInviteButton } from "@/components/team-forms";
import { ROLE_LABELS, isOwner, type Role } from "@/core/tenancy";
import { ROLE_NOTES, ROLE_ORDER } from "@/lib/role-notes";
import { pageSession } from "@/server/auth/page-session";
import { listInvites } from "@/server/db/invites";
import { listMembers } from "@/server/db/team";

export const metadata = { title: "Team · Kleeno" };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

function RoleChips({ roles }: { roles: readonly Role[] }) {
  return <div className="flex flex-wrap gap-1">{roles.map((r) => <Chip key={r} tone={r === "OWNER" ? "dark" : "neutral"}>{ROLE_LABELS[r]}</Chip>)}</div>;
}

export default async function TeamPage() {
  await connection();
  const session = await pageSession();
  const { actor } = session;
  const canEdit = isOwner(actor.roles);
  const [members, invites] = await Promise.all([listMembers(actor.companyId), canEdit ? listInvites(actor.companyId) : Promise.resolve([])]);
  const pending = invites.filter((i) => i.status === "PENDING");
  const owners = members.filter((m) => m.roles.includes("OWNER"));

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Company, team, pay policy, billing and your own account.</p>
      </header>
      <SettingsNavigation roles={actor.roles} current="/settings/team">
        <div className="flex min-w-0 flex-col gap-4">
          {!canEdit && <Notice icon={Lock}><p><b>You can see the team.</b> Only Owners can invite people, change roles or remove members.</p></Notice>}
          <div className="grid min-w-0 items-start gap-4 min-[1440px]:grid-cols-[minmax(0,1fr)_18.75rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="min-w-0 rounded-card border border-border bg-card" aria-labelledby="h-members">
                <PanelHead icon={Users} title="Members" id="h-members">
                  <Chip>{members.length} active</Chip>
                  {canEdit && <Chip>{pending.length} invited</Chip>}
                </PanelHead>
                {canEdit && (
                  <details className="group mx-4 mt-3">
                    <summary className="inline-flex h-7.5 cursor-pointer list-none items-center gap-1.5 rounded-field border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground group-open:border-border group-open:bg-background group-open:text-foreground max-[520px]:min-h-11 [&::-webkit-details-marker]:hidden"><UserPlus aria-hidden="true" className="size-4" />Invite member</summary>
                    <div className="my-3 rounded-card border border-border bg-background p-4">
                      <InviteForm />
                    </div>
                  </details>
                )}
                <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Members, scroll sideways for more">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <caption className="sr-only">Team members of this company</caption>
                    <thead>
                      <tr className="bg-secondary text-left text-[13px] text-muted-foreground">
                        <th scope="col" className="h-9 border-y border-border px-4 font-medium">Member</th>
                        <th scope="col" className="h-9 border-y border-border px-3 font-medium">Roles</th>
                        <th scope="col" className="h-9 border-y border-border px-4 text-right font-medium">{canEdit ? "Actions" : <span className="sr-only">Actions</span>}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.userId} className="align-middle">
                          <td className="border-b border-border px-4 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar>{(m.email ?? "?").slice(0, 1).toUpperCase()}</Avatar>
                              <div className="min-w-0">
                                <b className="block break-all font-medium">{m.email ?? "—"}</b>
                                <span className="text-xs text-muted-foreground">Joined {when(m.joinedAt)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="border-b border-border px-3 py-2.5"><RoleChips roles={m.roles} /></td>
                          <td className="border-b border-border px-4 py-2.5 text-right">
                            {canEdit && <MemberActions userId={m.userId} roles={m.roles} isSelf={m.userId === actor.userId} lastOwner={owners.length === 1 && m.roles.includes("OWNER")} label={m.email ?? undefined} />}
                          </td>
                        </tr>
                      ))}
                      {pending.map((i) => (
                        <tr key={i.id} className="align-middle">
                          <td className="border-b border-border px-4 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar dashed><Mail className="size-3.5" /></Avatar>
                              <div className="min-w-0">
                                <b className="block break-all font-medium">{i.email}</b>
                                <span className="text-xs text-muted-foreground">Invite pending · sent {when(i.createdAt)} · expires {when(i.expiresAt)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="border-b border-border px-3 py-2.5"><RoleChips roles={i.roles} /></td>
                          <td className="border-b border-border px-4 py-2.5 text-right"><RevokeInviteButton id={i.id} email={i.email} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">A member can hold several roles. Roles apply to this company only; the same person can have different roles in another company. Two-step and last-active details are planned and not shown yet.</div>
              </section>
              {owners.length === 1 && (
                <Notice icon={Lock}><p><b>Last Owner is protected.</b> {owners[0].userId === actor.userId ? "You are" : (owners[0].email ?? "One member") + " is"} the only Owner, so that role can&apos;t be removed. Add a second Owner first.</p></Notice>
              )}
              <Notice icon={Users}><p><b>Four-eyes on every run.</b> The person who approves the payroll and the person who signs the payment must be different people for the same run. Kleeno checks this in the database, not only on screen.</p></Notice>
            </div>

            <section className="rounded-card border border-border bg-card" aria-labelledby="h-roles">
              <PanelHead icon={ShieldCheck} title="What each role can do" id="h-roles" />
              <ul className="m-0 list-none p-0">
                {ROLE_ORDER.map((role) => (
                  <li key={role} className="border-b border-border px-4 py-2.5 last:border-b-0">
                    <Chip tone={role === "OWNER" ? "dark" : "neutral"}>{ROLE_LABELS[role]}</Chip>
                    <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_NOTES[role]}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">The server checks every action, whatever the screen shows.</div>
            </section>
          </div>
        </div>
      </SettingsNavigation>
    </>
  );
}
