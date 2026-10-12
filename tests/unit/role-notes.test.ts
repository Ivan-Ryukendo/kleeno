import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "@/core/tenancy";
import { ROLE_NOTES, ROLE_ORDER } from "@/lib/role-notes";

describe("role notes (invite page and Settings > Team)", () => {
  it("has one plain-language note for every role, in a fixed order", () => {
    expect([...ROLE_ORDER].sort()).toEqual(Object.keys(ROLE_LABELS).sort());
    for (const role of ROLE_ORDER) expect(ROLE_NOTES[role].length).toBeGreaterThan(10);
  });
  it("keeps the four-eyes promise visible for payroll approvers", () => {
    expect(ROLE_NOTES.PAYROLL_APPROVER).toMatch(/no one approves and pays alone/);
  });
});
