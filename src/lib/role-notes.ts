import type { Role } from "@/core/tenancy";

// One plain-language line per role, shared by Settings > Team and the invite page. Source: the role hints and docs/route-action-matrix.md.
export const ROLE_NOTES: Record<Role, string> = {
  OWNER: "Company details, team and invites; switches live payments on after approval.",
  HR_APPROVER: "Pay policy, imports, exceptions and calculation.",
  PAYROLL_APPROVER: "Reviews calculated pay and approves the run. A different person signs payments, so no one approves and pays alone.",
  PAYMENT_APPROVER: "Signs payments, releases holds and confirms recipient changes.",
  VIEWER: "Can look, cannot change anything.",
};
export const ROLE_ORDER: Role[] = ["OWNER", "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER", "VIEWER"];
