import { Banknote, Building2, CalendarClock, FileText, House, TriangleAlert, Upload, Users, UsersRound, type LucideIcon } from "lucide-react";
import { isOwner, isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";

// One list drives the sidebar, the search palette and the breadcrumb. Showing an item is a convenience only:
// the server still checks every action (rule 33), and a hidden page still answers for itself.
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that keep this item highlighted (a run page belongs to "Pay runs"). */
  also?: string[];
  badge?: "exceptions";
  show: (roles: readonly Role[]) => boolean;
  keywords?: string;
}
export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const everyone = () => true;
const payrollSide = (r: readonly Role[]) => isPayrollRole(r) || isOwner(r);
const paymentSide = (r: readonly Role[]) => isPaymentRole(r) || isOwner(r);

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: "/dashboard", label: "Home", icon: House, show: everyone, keywords: "dashboard overview start" }] },
  {
    label: "Payroll",
    items: [
      { href: "/dashboard#pay-runs", label: "Pay runs", icon: CalendarClock, also: ["/runs"], show: everyone, keywords: "runs payroll periods" },
      { href: "/exceptions", label: "Exceptions", icon: TriangleAlert, badge: "exceptions", show: payrollSide, keywords: "issues flagged review" },
      { href: "/settlement", label: "Payments", icon: Banknote, also: ["/settlement"], show: paymentSide, keywords: "settlement pay plan sign usdc" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/workers", label: "Workers", icon: Users, show: everyone, keywords: "payees contractors employees" },
      { href: "/import", label: "Import", icon: Upload, show: payrollSide, keywords: "csv timesheets upload" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/configuration", label: "Pay policy", icon: FileText, show: payrollSide, keywords: "configuration rules overtime" },
      { href: "/settings/team", label: "Team", icon: UsersRound, show: everyone, keywords: "members roles invite" },
      { href: "/settings/company", label: "Company", icon: Building2, show: everyone, keywords: "settings schedule details" },
    ],
  },
];

export const visibleNav = (roles: readonly Role[]): NavGroup[] => NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.show(roles)) })).filter((g) => g.items.length > 0);

const path = (href: string) => href.split("#")[0];
/** Which nav item a pathname belongs to. "Pay runs" and "Home" share /dashboard, so Home wins there. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/dashboard#pay-runs") return pathname.startsWith("/runs");
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return [path(item.href), ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Breadcrumb for the top bar: [group, page] from the pathname. */
export function crumbs(pathname: string): string[] {
  if (pathname.startsWith("/runs/")) return ["Payroll", "Pay runs", "Run"];
  if (pathname === "/account") return ["Account"];
  for (const g of NAV) for (const i of g.items) if (isActive(i, pathname)) return g.label ? [g.label, i.label] : [i.label];
  return [];
}
