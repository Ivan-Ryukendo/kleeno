// Roles come only from `memberships` (rule 33, S61): one row per (user, company), several roles per member.
// Pure checks only; the server loads the roles and the database re-checks the ones that matter (four-eyes triggers).
export const ROLES = ["OWNER", "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  HR_APPROVER: "HR approver",
  PAYROLL_APPROVER: "Payroll approver",
  PAYMENT_APPROVER: "Payment approver",
  VIEWER: "Viewer",
};

type Roles = readonly Role[];
export const hasRole = (roles: Roles, ...wanted: Role[]) => wanted.some((r) => roles.includes(r));
/** The payroll side configures, imports, reconciles, calculates and approves payroll. */
export const isPayrollRole = (roles: Roles) => hasRole(roles, "PAYROLL_APPROVER", "HR_APPROVER");
export const isPaymentRole = (roles: Roles) => hasRole(roles, "PAYMENT_APPROVER");
export const isOwner = (roles: Roles) => hasRole(roles, "OWNER");
/** Roles that widen payment or payroll authority: granting them needs re-authentication (rule 47, S63). */
export const isAuthorityRole = (r: Role) => r === "PAYROLL_APPROVER" || r === "PAYMENT_APPROVER";

/** Changing a member's roles: the company must always keep an Owner (S63). */
export function keepsAnOwner(members: readonly { userId: string; roles: Roles }[], userId: string, next: Roles | null): boolean {
  return members.some((m) => (m.userId === userId ? next !== null && isOwner(next) : isOwner(m.roles)));
}
