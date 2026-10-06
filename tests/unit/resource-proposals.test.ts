import { describe, expect, it } from "vitest";
import { runValidated, type AiProvider } from "@/core/ai";
import { resourcePolicyInput } from "@/core/ai/inputs/resources";
import { resourcePolicySpec } from "@/core/ai/resources";
import type { ResourceDefinition } from "@/core/views/resources";
type LeaveRule = Extract<ResourceDefinition["rule"], { kind: "LEAVE_BALANCE" }>;

const clauses = [{ id: "C1", text: "Report attendance days as the count of distinct approved attendance dates for the period." }];
const output = { outcome: "PROPOSED", reasons: [], columns: [{ label: "Attendance days", policy: { configVersion: 2, clauseIds: ["C1"] }, rule: { kind: "ATTENDANCE_DAYS" } }] };
const fake = (value: unknown): AiProvider => ({ name: "fixture", complete: async () => ({ text: JSON.stringify(value), model: "fixture" }) });

describe("policy resource proposals are advisory", () => {
  it("uses only supplied approved policy and supported typed definitions", async () => {
    const result = await runValidated(fake(output), resourcePolicySpec(clauses, 2), resourcePolicyInput(clauses, 2, "fixture"));
    expect(result.status).toBe("ACCEPTED");
    expect(result.flags).toContain("HR must review every proposed resource definition before use");
  });
  it("rejects missing citations, wrong versions and executable rules", async () => {
    for (const proposal of [
      { ...output, columns: [{ ...output.columns[0], policy: { configVersion: 2, clauseIds: ["C9"] } }] },
      { ...output, columns: [{ ...output.columns[0], policy: { configVersion: 3, clauseIds: ["C1"] } }] },
      { ...output, columns: [{ ...output.columns[0], rule: { kind: "SQL", query: "select *" } }] },
    ]) expect((await runValidated(fake(proposal), resourcePolicySpec(clauses, 2), resourcePolicyInput(clauses, 2, "fixture"))).status).toBe("NEEDS_HUMAN_REVIEW");
  });
  it("refuses unsupported leave entitlement and forged labels", async () => {
    const leave = { ...output, columns: [{ label: "Leave", policy: { configVersion: 2, clauseIds: ["C1"] }, rule: { kind: "LEAVE_BALANCE", unit: "DAYS", yearStart: "2026-01-01", yearEnd: "2026-12-31", accrual: "ANNUAL", entitlement: "30", creditTiming: "START", carryOverCap: "5", carryOverExpiresOn: null } }] };
    expect((await runValidated(fake(leave), resourcePolicySpec(clauses, 2), resourcePolicyInput(clauses, 2, "fixture"))).status).toBe("NEEDS_HUMAN_REVIEW");
    expect((await runValidated(fake({ ...output, columns: [{ ...output.columns[0], label: "<script>secret</script>" }] }), resourcePolicySpec(clauses, 2), resourcePolicyInput(clauses, 2, "fixture"))).status).toBe("NEEDS_HUMAN_REVIEW");
  });
  it("policy inputs cannot carry workers, salaries or custom requests", () => {
    const input = resourcePolicyInput(clauses, 2, "fixture");
    expect(JSON.parse(input.json)).toEqual({ clauses, configVersion: 2, resourceCatalog: ["INPUT", "ATTENDANCE_DAYS", "LEAVE_BALANCE", "PERFORMANCE"] });
  });
  it("binds each number to its policy field instead of accepting a swapped entitlement/cap or KPI weight", () => {
    const source = [{ id: "C1", text: "Annual entitlement: 24 days. Leave year 2026-01-01 to 2026-12-31. Annual credit at START. Carry-over cap: 5 days; no expiry. Performance: Delivery weight 60%; Quality weight 40%." }];
    const spec = resourcePolicySpec(source, 2);
    const leave = { label: "Leave", policy: { configVersion: 2, clauseIds: ["C1"] }, rule: { kind: "LEAVE_BALANCE" as const, unit: "DAYS" as const, yearStart: "2026-01-01", yearEnd: "2026-12-31", accrual: "ANNUAL" as const, entitlement: "5", creditTiming: "START" as const, carryOverCap: "24", carryOverExpiresOn: null } };
    expect(spec.check({ outcome: "PROPOSED", reasons: [], columns: [leave] }).problems.length).toBeGreaterThan(0);
    expect(spec.check({ outcome: "PROPOSED", reasons: [], columns: [{ ...leave, rule: { ...leave.rule, entitlement: "24", carryOverCap: "5" } }] }).problems).toEqual([]);
    const kpis = { label: "Performance", policy: leave.policy, rule: { kind: "PERFORMANCE" as const, metrics: [{ id: "delivery", label: "Delivery", weight: "40" }, { id: "quality", label: "Quality", weight: "60" }] } };
    expect(spec.check({ outcome: "PROPOSED", reasons: [], columns: [kpis] }).problems.length).toBeGreaterThan(0);
  });
  it("binds leave cycle, unit, credit timing and expiry to leave fields", () => {
    const rule: LeaveRule = { kind: "LEAVE_BALANCE", unit: "DAYS", yearStart: "2026-01-01", yearEnd: "2026-12-31", accrual: "ANNUAL", entitlement: "24", creditTiming: "START", carryOverCap: "5", carryOverExpiresOn: null };
    const policy = "The leave year starts 2026-01-01 and ends 2026-12-31. Annual entitlement is 24 days credited at the start. The carry-over cap is 5 days and has no expiry.";
    const check = (text: string, changes: Partial<typeof rule> = {}) => resourcePolicySpec([{ id: "C1", text }], 2).check({ outcome: "PROPOSED", reasons: [], columns: [{ label: "Leave", policy: { configVersion: 2, clauseIds: ["C1"] }, rule: { ...rule, ...changes } }] }).problems;
    expect(check(policy)).toEqual([]);
    expect(check(policy, { creditTiming: "END" })).not.toEqual([]);
    expect(check(policy + " Monthly reports are required.", { accrual: "MONTHLY" })).not.toEqual([]);
    expect(check(policy + " Working hours are recorded.", { unit: "HOURS" })).not.toEqual([]);
    expect(check(policy + " Performance review expiry: 2026-06-30.", { carryOverExpiresOn: "2026-06-30" })).not.toEqual([]);
    expect(check(policy.replace("and has no expiry", "").concat(" Performance reports have no expiry."))).not.toEqual([]);
    expect(check(policy.replace("2026-01-01", "2025-01-01").concat(" Review period starts 2026-01-01."))).not.toEqual([]);
    expect(check(policy.replace("2026-12-31", "2027-12-31").concat(" Review period ends 2026-12-31."))).not.toEqual([]);
  });
  it("requires a single explicit interpretation for leave fields", () => {
    const policy = "Leave year 2026-01-01 to 2026-12-31. Annual entitlement: 24 days. Annual credit at START. Carry-over cap: 5 days; no expiry.";
    const rule: LeaveRule = { kind: "LEAVE_BALANCE", unit: "DAYS", yearStart: "2026-01-01", yearEnd: "2026-12-31", accrual: "ANNUAL", entitlement: "24", creditTiming: "START", carryOverCap: "5", carryOverExpiresOn: null };
    const check = (text: string, changes: Partial<LeaveRule> = {}) => resourcePolicySpec([{ id: "C1", text }], 2).check({ outcome: "PROPOSED", reasons: [], columns: [{ label: "Leave", policy: { configVersion: 2, clauseIds: ["C1"] }, rule: { ...rule, ...changes } }] }).problems;
    for (const conflict of ["Annual credit at END.", "Monthly credit at START.", "Annual entitlement: 24 hours.", "Carry-over expires on 2026-06-30."]) expect(check(`${policy} ${conflict}`)).not.toEqual([]);
    const expiring = policy.replace("no expiry", "expires on 2026-06-30");
    expect(check(expiring, { carryOverExpiresOn: "2026-06-30" })).toEqual([]);
    expect(check(policy.replace("Annual credit at START", "Payroll starts in January"))).not.toEqual([]);
    const monthly = policy.replace("Annual entitlement: 24 days", "Monthly entitlement: 24 days").replace("Annual credit", "Monthly credit");
    expect(check(monthly, { accrual: "MONTHLY" })).not.toEqual([]); // annual entitlement is divided by 12; a monthly grant is a different quantity.
  });
});
