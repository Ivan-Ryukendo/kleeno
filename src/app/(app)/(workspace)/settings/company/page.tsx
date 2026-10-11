import { Building2, CalendarDays, Clock, Lock, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { SettingsNavigation } from "@/components/settings-navigation";
import { BasicsForm, ScheduleForm } from "@/components/company-form";
import { Chip, Notice, PanelHead, SettingsRow } from "@/components/people-ui";
import { countryOptions, type PayFrequency } from "@/core/company";
import { timeZoneChoices } from "@/lib/timezone-display";
import { nextPayDates, todayIn } from "@/lib/pay-dates";
import { isOwner } from "@/core/tenancy";
import { isPaymentRole } from "@/core/workflow";
import { pageSession } from "@/server/auth/page-session";
import { getCompany } from "@/server/db/company";

export const metadata = { title: "Company · Kleeno" };

export default async function CompanySettingsPage() {
  await connection();
  const session = await pageSession();
  const { actor } = session;
  const company = await getCompany(actor.companyId);
  const canEdit = isOwner(actor.roles);
  const payments = canEdit || isPaymentRole(actor.roles);
  const upcoming = nextPayDates(company.profile.payFrequency as PayFrequency | null, company.profile.payDay, todayIn(company.profile.timezone));

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Company, team, pay policy, billing and your own account.</p>
      </header>
      <SettingsNavigation roles={actor.roles} current="/settings/company">
        <div className="flex min-w-0 flex-col gap-4">
          <Notice icon={Lock}>
            {canEdit ? <p><b>Owner view.</b> You are an Owner, so you can edit company settings. Other members see this page read-only.</p> : <p><b>Only Owners can edit company settings.</b> You can read everything here. To change something, ask an Owner of this company.</p>}
          </Notice>

          <section className="rounded-card border border-border bg-card" aria-labelledby="h-details">
            <PanelHead icon={Building2} title="Company details" id="h-details" />
            <BasicsForm layout="rows" profile={company.profile} options={{ countries: countryOptions(), zones: timeZoneChoices() }} disabled={!canEdit} />
          </section>

          <section className="rounded-card border border-border bg-card" aria-labelledby="h-sched">
            <PanelHead icon={CalendarDays} title="Pay schedule" id="h-sched" />
            <ScheduleForm layout="rows" profile={company.profile} disabled={!canEdit} />
            <div className="border-t border-border">
              <SettingsRow label="Next pay dates" hint="Calendar dates from the schedule above.">
                {upcoming.length > 0 ? (
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {upcoming.map((u) => (
                      <li key={u.month + u.payDate} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-field border border-border px-2.5 py-2 tabular-nums">
                        <b className="min-w-28 font-medium">{u.month}</b>
                        <span className="inline-flex items-center gap-1.5"><Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />Pay date {u.payDate}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pt-1.5 text-muted-foreground">{company.profile.payFrequency === "BIWEEKLY" ? "Dates for an every-two-weeks schedule depend on the first period you open, so none are shown here." : "Choose a pay frequency to see upcoming pay dates."}</p>
                )}
                <small className="mt-1.5 block text-xs text-muted-foreground">Weekends and public holidays are not adjusted. Input cutoffs are planned and not part of this schedule yet.</small>
              </SettingsRow>
            </div>
          </section>

          <section className="rounded-card border border-border bg-card" aria-labelledby="h-mode">
            <PanelHead icon={ShieldCheck} title="Run mode" id="h-mode" />
            <SettingsRow label="Default mode" hint="Shown on every page and every run.">
              <p className="flex flex-wrap items-center gap-2 pt-1.5"><Chip tone="dark">SIMULATION</Chip>Never pays</p>
              <small className="mt-1.5 block text-xs text-muted-foreground">Simulation runs import, calculate and trace, but no money moves and no payment can be sent.</small>
            </SettingsRow>
            <SettingsRow label="Live payments" hint="Arc testnet USDC, no real funds.">
              <p className="flex flex-wrap items-center gap-2 pt-1.5">{company.liveEnabled ? <Chip tone="ok">ON</Chip> : <Chip tone="risk">OFF</Chip>}Live payments are {company.liveEnabled ? "on" : "off"}</p>
              <small className="mt-1.5 block text-xs text-muted-foreground">{company.liveEnabled ? "A payment approver signs each plan; an Owner or payment approver can switch live payments off from Payments at any time." : "A payment approver or Owner requests live payments from Payments. The Kleeno team reviews the request, then an Owner switches them on with a password and a two-step code."}</small>
              {payments && <p className="mt-2"><Link href="/settlement" className="inline-flex h-7.5 items-center gap-1.5 rounded-field border border-border bg-background px-3 text-[13px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[520px]:min-h-11"><Wallet aria-hidden="true" className="size-4" />Open Payments</Link></p>}
            </SettingsRow>
            <SettingsRow label="Kind of company">
              <p className="pt-1.5">{company.isDemo ? "Demo" : company.isSandbox ? "Sandbox (simulation only)" : "Standard"}</p>
            </SettingsRow>
          </section>
        </div>
      </SettingsNavigation>
    </>
  );
}
