import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, CreditCard, FileText, UserRound, UsersRound } from "lucide-react";
import { isOwner, isPayrollRole, type Role } from "@/core/tenancy";

const sections = [
  { href: "/settings/company", label: "Company", icon: Building2, show: () => true },
  { href: "/settings/team", label: "Team", icon: UsersRound, show: () => true },
  { href: "/configuration", label: "Pay policy", icon: FileText, show: (roles: readonly Role[]) => isPayrollRole(roles) || isOwner(roles) },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, show: isOwner },
  { href: "/account", label: "Account", icon: UserRound, show: () => true },
];

/** Page links share existing visibility rules; each destination still checks access. */
export function SettingsNavigation({ roles, current, children }: { roles: readonly Role[]; current: string; children: ReactNode }) {
  return (
    <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8">
      <nav aria-label="Settings sections" className="flex min-w-0 flex-wrap content-start gap-1 border-b border-border pb-3 lg:flex-col lg:border-b-0 lg:pb-0">
        {sections.filter(section => section.show(roles)).map(section => (
          <Link key={section.href} href={section.href} aria-current={current === section.href ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${current === section.href ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
            <section.icon aria-hidden="true" className="size-4 shrink-0" />
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 [&>section:first-child]:mt-0">{children}</div>
    </div>
  );
}
