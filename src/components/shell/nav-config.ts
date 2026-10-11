import { Banknote, Building2, CalendarClock, CalendarPlus, CircleHelp, CreditCard, FileText, GitBranch, History, LayoutDashboard, Settings, Table2, TriangleAlert, Upload, UserRound, Users, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import { isOwner, isPaymentRole, isPayrollRole, type Role } from "@/core/tenancy";

// One place for every way into a page: the sidebar, the run tabs, the settings sections and the search palette (R9.2).
// Showing an item is a convenience only: the server still checks every action (rule 33), and a hidden page still answers
// for itself. Every destination in docs/route-action-matrix.md must stay reachable from one of these lists
// (tests/unit/nav-config.test.ts).
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that keep this item highlighted (Payroll owns the run pages and their secondary screens). */
  match?: string[];
  badge?: "exceptions";
  show: (roles: readonly Role[]) => boolean;
  keywords?: string;
}
export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}
export interface RunRef {
  id: string;
  label: string;
}

const everyone = () => true;
export const payrollSide = (r: readonly Role[]) => isPayrollRole(r) || isOwner(r);
const paymentSide = (r: readonly Role[]) => isPaymentRole(r) || isOwner(r);

/** Where Payroll goes when no run exists yet: the pay-runs list (and, for payroll roles, the start-run form) on the dashboard. */
export const PAYROLL_FALLBACK = "/dashboard#pay-runs";
const PAYROLL_PATHS = ["/runs", "/exceptions", "/import", "/settlement", "/audit"];
const SETTINGS_PATHS = ["/settings", "/configuration", "/account"];

/** Payroll opens the current run (the newest one the shell knows about), else the pay-runs list. */
export const payrollHref = (runs: readonly Pick<RunRef, "id">[]) => (runs[0] ? `/runs/${encodeURIComponent(runs[0].id)}` : PAYROLL_FALLBACK);

/** Sidebar: Dashboard · Payroll · All Workers, a separator, then Settings · Help. The account chip sits at the foot. */
export function sidebarNav(roles: readonly Role[], runs: readonly Pick<RunRef, "id">[] = []): NavGroup[] {
  const groups: NavGroup[] = [
    {
      id: "main",
      label: null,
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: everyone, keywords: "home overview start" },
        { href: payrollHref(runs), label: "Payroll", icon: Table2, match: PAYROLL_PATHS, badge: "exceptions", show: everyone, keywords: "runs periods pay run" },
        { href: "/workers", label: "All Workers", icon: Users, show: everyone, keywords: "payees contractors employees people" },
      ],
    },
    {
      id: "secondary",
      label: null,
      items: [
        { href: "/settings/company", label: "Settings", icon: Settings, match: SETTINGS_PATHS, show: everyone, keywords: "company team policy billing account" },
        { href: "/support", label: "Help", icon: CircleHelp, show: everyone, keywords: "support request ticket" },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show(roles)) })).filter((g) => g.items.length > 0);
}

/** Settings frame sections, shared by /settings/*, /configuration and /account. */
export const SETTINGS_NAV: NavGroup[] = [
  {
    id: "company",
    label: "Company",
    items: [
      { href: "/settings/company", label: "Company", icon: Building2, show: everyone, keywords: "settings details schedule" },
      { href: "/settings/team", label: "Team", icon: UsersRound, show: everyone, keywords: "members roles invite" },
      { href: "/configuration", label: "Pay policy", icon: FileText, show: payrollSide, keywords: "configuration rules overtime" },
      { href: "/settings/billing", label: "Billing", icon: CreditCard, show: isOwner, keywords: "subscription usage terms" },
    ],
  },
  { id: "personal", label: "Personal", items: [{ href: "/account", label: "Account", icon: UserRound, show: everyone, keywords: "password mfa two-step sign out" }] },
];

export const settingsNav = (roles: readonly Role[]): NavGroup[] =>
  SETTINGS_NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.show(roles)) })).filter((g) => g.items.length > 0);

/** Payroll screens that are not sidebar items any more; the search palette (and the run page) keep them one step away. */
const PAYROLL_PAGES: NavItem[] = [
  { href: PAYROLL_FALLBACK, label: "Pay runs", icon: CalendarClock, show: everyone, keywords: "payroll runs periods" },
  { href: "/dashboard#start-run", label: "Start a pay run", icon: CalendarPlus, show: isPayrollRole, keywords: "run payroll new period create" },
  { href: "/exceptions", label: "Needs review", icon: TriangleAlert, show: payrollSide, keywords: "exceptions issues flagged resolve" },
  { href: "/import", label: "Import", icon: Upload, show: payrollSide, keywords: "csv timesheets upload leave" },
  { href: "/settlement", label: "Payments", icon: Banknote, show: paymentSide, keywords: "settlement pay plan sign usdc live" },
  { href: "/audit", label: "Activity", icon: History, show: everyone, keywords: "audit log history timeline evidence" },
];

/** Every page the palette offers to these roles, in a stable order and without duplicates. */
export function searchPages(roles: readonly Role[]): NavItem[] {
  const [main, secondary] = [sidebarNav(roles)[0]?.items ?? [], sidebarNav(roles)[1]?.items ?? []];
  const all = [
    ...main.filter((i) => i.label !== "Payroll"),
    ...PAYROLL_PAGES,
    ...settingsNav(roles).flatMap((g) => g.items),
    ...secondary.filter((i) => i.label !== "Settings"),
  ].filter((i) => i.show(roles));
  return all.filter((item, index) => all.findIndex((other) => other.href === item.href) === index);
}

export type RunViewId = "table" | "workflow" | "payments" | "activity";
export interface RunView {
  id: RunViewId;
  label: string;
  icon: LucideIcon;
  /** Null when the view exists but this run or role cannot use it; `reason` says why. */
  href: string | null;
  reason?: string;
}

/** Run tabs. Payments keeps its gate: never for SIMULATION runs and only for payment approvers (`canPay` = isPaymentRole;
 * the settlement page and every payment handler check again). */
export function runViews(runId: string, mode: string, canPay: boolean): RunView[] {
  const root = `/runs/${encodeURIComponent(runId)}`;
  const run = new URLSearchParams({ run: runId });
  const open = mode !== "SIMULATION" && canPay;
  return [
    { id: "table", label: "Table", icon: Table2, href: root },
    { id: "workflow", label: "Workflow", icon: GitBranch, href: `${root}/workflow` },
    { id: "payments", label: "Payments", icon: Wallet, href: open ? `/settlement?${run}` : null, reason: mode === "SIMULATION" ? "Simulation never pays" : open ? undefined : "Payment approvers only" },
    { id: "activity", label: "Activity", icon: History, href: `/audit?${run}` },
  ];
}

const path = (href: string) => href.split(/[?#]/)[0];
/** Which nav item a pathname belongs to. */
export function isActive(item: NavItem, pathname: string): boolean {
  return (item.match ?? [path(item.href)]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-01 to 2026-10-31" reads as "October 2026"; any other period keeps its exact dates. */
export function periodLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) to (\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!m) return label;
  const [, y1, m1, d1, y2, m2, d2] = m;
  const lastDay = new Date(Date.UTC(Number(y1), Number(m1), 0)).getUTCDate();
  if (y1 === y2 && m1 === m2 && Number(d1) === 1 && Number(d2) === lastDay) return `${MONTHS[Number(m1) - 1]} ${y1}`;
  return label;
}

/** Breadcrumb for the top bar: company, section, then the run and view where there is one. */
export function crumbs(pathname: string, context: { company?: string; runs?: readonly RunRef[] } = {}): string[] {
  const head = context.company ? [context.company] : [];
  const settings: Record<string, string> = { "/settings/company": "Company", "/settings/team": "Team", "/settings/billing": "Billing", "/configuration": "Pay policy", "/account": "Account" };
  if (pathname in settings) return [...head, "Settings", settings[pathname]];
  const run = /^\/runs\/([^/]+)(\/workflow)?\/?$/.exec(pathname);
  if (run) {
    const id = decodeURIComponent(run[1]);
    const known = context.runs?.find((r) => r.id === id);
    return [...head, "Payroll", known ? periodLabel(known.label) : "Run", ...(run[2] ? ["Workflow"] : [])];
  }
  const payroll: Record<string, string> = { "/exceptions": "Needs review", "/import": "Import", "/settlement": "Payments", "/audit": "Activity" };
  if (pathname in payroll) return [...head, "Payroll", payroll[pathname]];
  if (pathname === "/dashboard") return [...head, "Dashboard"];
  if (pathname === "/workers") return [...head, "All Workers"];
  if (pathname === "/support") return [...head, "Help"];
  return head;
}

/** Initials for the account chip from the sign-in email ("maya.reyes@x" -> "MR"); no display name is stored. */
export function initials(email: string | null): string {
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._+-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase() || "?";
}
