import { describe, expect, it } from "vitest";
import { hasRole, isAuthorityRole, isOwner, isPaymentRole, isPayrollRole, keepsAnOwner, type Role } from "@/core/tenancy";

describe("role checks (S63)", () => {
  it("a member may hold several roles; each check looks at the whole list", () => {
    const both: Role[] = ["OWNER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"];
    expect([isOwner(both), isPayrollRole(both), isPaymentRole(both)]).toEqual([true, true, true]);
    expect([isOwner(["VIEWER"]), isPayrollRole(["VIEWER"]), isPaymentRole(["VIEWER"])]).toEqual([false, false, false]);
    expect(isPayrollRole(["HR_APPROVER"])).toBe(true);
    expect(isPayrollRole(["OWNER"])).toBe(false); // an Owner manages the company; payroll authority is a separate role
    expect(hasRole(["VIEWER"], "OWNER", "VIEWER")).toBe(true);
  });

  it("only the payroll and payment roles widen authority (re-auth when granted)", () => {
    expect((["OWNER", "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER", "VIEWER"] as Role[]).filter(isAuthorityRole)).toEqual(["PAYROLL_APPROVER", "PAYMENT_APPROVER"]);
  });

  it("a company always keeps an Owner", () => {
    const team = [
      { userId: "a", roles: ["OWNER", "VIEWER"] as Role[] },
      { userId: "b", roles: ["PAYROLL_APPROVER"] as Role[] },
    ];
    expect(keepsAnOwner(team, "a", null)).toBe(false); // removing the only Owner
    expect(keepsAnOwner(team, "a", ["VIEWER"])).toBe(false); // demoting the only Owner
    expect(keepsAnOwner(team, "a", ["OWNER"])).toBe(true);
    expect(keepsAnOwner(team, "b", null)).toBe(true); // removing someone else
    expect(keepsAnOwner([...team, { userId: "c", roles: ["OWNER"] }], "a", null)).toBe(true);
  });
});
