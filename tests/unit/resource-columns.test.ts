import { describe, expect, it } from "vitest";
import { ResourceDefinitionSchema, evaluateResource, type ResourceDefinition } from "@/core/views/resources";
import { applyView, defaultView, toCsv, validateView, type ColumnDef } from "@/core/views";

const base = { label: "Leave available", policy: { configVersion: 1, clauseIds: ["C1"] } };
const leave: ResourceDefinition = { ...base, rule: { kind: "LEAVE_BALANCE", unit: "DAYS", yearStart: "2026-01-01", yearEnd: "2026-12-31", accrual: "MONTHLY", entitlement: "24", creditTiming: "END", carryOverCap: "5", carryOverExpiresOn: "2026-03-31" } };
const input = { sourceRef: "HR ledger v1", reason: "Reviewed opening ledger", openingBalance: "0", openingAsOf: "2025-12-31", carryOver: "8", used: "3", asOf: "2026-02-28" };

describe("policy-backed resources", () => {
  it("requires policy configuration rather than assumed entitlements", () => {
    expect(ResourceDefinitionSchema.safeParse({ label: "Leave", rule: { kind: "LEAVE_BALANCE" } }).success).toBe(false);
    expect(evaluateResource(leave, null).status).toBe("DATA_REQUIRED");
  });
  it("credits exact monthly entitlement, caps carry-over and subtracts approved usage", () => {
    expect(evaluateResource(leave, input)).toMatchObject({ status: "VERIFIED", value: "6.00" });
    expect(evaluateResource(leave, { ...input, asOf: "2026-04-30" }).value).toBe("5.00");
  });
  it("does not credit grant dates already included in opening balance", () => {
    expect(evaluateResource(leave, { ...input, openingBalance: "7", openingAsOf: "2026-01-31", carryOver: "0", used: "1" }).value).toBe("8.00");
  });
  it("handles annual grants and rejects dates outside the approved leave year", () => {
    const annual = { ...leave, rule: { ...leave.rule, accrual: "ANNUAL" as const, creditTiming: "START" as const } } as ResourceDefinition;
    expect(evaluateResource(annual, input).value).toBe("26.00");
    expect(evaluateResource(leave, { ...input, asOf: "2027-01-01" }).status).toBe("DATA_REQUIRED");
  });
  it("supports a single actual/target ratio and a weighted KPI score exactly", () => {
    const single: ResourceDefinition = { ...base, label: "Delivery", rule: { kind: "PERFORMANCE", metrics: [{ id: "delivery", label: "Delivery", weight: "100" }] } };
    expect(evaluateResource(single, { sourceRef: "Review Q1", reason: "HR reviewed", periodStart: "2026-01-01", periodEnd: "2026-03-31", metrics: [{ id: "delivery", actual: "3", target: "4" }] }).value).toBe("75.00");
    const weighted: ResourceDefinition = { ...single, rule: { kind: "PERFORMANCE", metrics: [{ id: "delivery", label: "Delivery", weight: "60" }, { id: "quality", label: "Quality", weight: "40" }] } };
    expect(evaluateResource(weighted, { sourceRef: "Review Q1", reason: "HR reviewed", periodStart: "2026-01-01", periodEnd: "2026-03-31", metrics: [{ id: "delivery", actual: "3", target: "4" }, { id: "quality", actual: "9", target: "10" }] }).value).toBe("81.00");
  });
  it("does not silently omit missing KPIs, zero targets or normalize invalid weights", () => {
    const d = { ...base, rule: { kind: "PERFORMANCE", metrics: [{ id: "a", label: "A", weight: "60" }, { id: "b", label: "B", weight: "40" }] } } as ResourceDefinition;
    expect(evaluateResource(d, { sourceRef: "HR", reason: "Reviewed", periodStart: "2026-01-01", periodEnd: "2026-01-31", metrics: [{ id: "a", actual: "1", target: "0" }] }).status).toBe("DATA_REQUIRED");
    expect(ResourceDefinitionSchema.safeParse({ ...d, rule: { ...d.rule, metrics: [{ id: "a", label: "A", weight: "90" }] } }).success).toBe(false);
  });
  it("counts distinct approved attendance dates, not duplicate records", () => {
    const d: ResourceDefinition = { ...base, label: "Attendance", rule: { kind: "ATTENDANCE_DAYS" } };
    expect(evaluateResource(d, { sourceRef: "Reviewed time register", reason: "HR reviewed", periodStart: "2026-01-01", periodEnd: "2026-01-31", dates: ["2026-01-02", "2026-01-02", "2026-01-03"] }).value).toBe("2");
    expect(evaluateResource(d, { sourceRef: "HR", reason: "Reviewed", periodStart: "2026-01-01", periodEnd: "2026-01-31", dates: ["2026-02-01"] }).status).toBe("DATA_REQUIRED");
  });
  it("allows only typed inputs, never executable formulas", () => {
    expect(ResourceDefinitionSchema.safeParse({ ...base, rule: { kind: "INPUT", type: "number", formula: "eval(secret)" } }).success).toBe(false);
    const d: ResourceDefinition = { label: "Capacity", policy: null, rule: { kind: "INPUT", type: "number" } };
    expect(evaluateResource(d, { sourceRef: "HR", reason: "Reviewed", value: "12.5" }).value).toBe("12.5");
    expect(evaluateResource(d, { sourceRef: "HR", reason: "Reviewed", value: "NaN" }).status).toBe("DATA_REQUIRED");
    expect(evaluateResource({ label: "Notes", policy: null, rule: { kind: "INPUT", type: "text" } }, { sourceRef: "HR", reason: "Reviewed", value: "  " }).status).toBe("DATA_REQUIRED");
  });
});

describe("column safety and export order", () => {
  it("exports in selected order, even when fields have been reordered", () => {
    const v = { ...defaultView("lines", ["HR_APPROVER"]), columns: ["net", "worker"] };
    expect(toCsv([{ worker: "W001", net: "10.00" }], v, ["HR_APPROVER"]).split("\r\n")[0]).toBe("Net (USDC),Worker");
  });
  it("rejects duplicate columns", () => {
    expect(() => validateView({ ...defaultView("workers", ["HR_APPROVER"]), columns: ["code", "code"] }, ["HR_APPROVER"])).toThrow();
  });
  it("missing values never satisfy negative numeric comparisons and sort before actual balances", () => {
    const columns: ColumnDef[] = [{ id: "balance", label: "Balance", type: "number" }];
    const v = { ...defaultView("workers", ["HR_APPROVER"]), columns: ["code", "balance"], filters: [{ column: "balance", op: "gt", value: "-10" }] };
    const rows = [{ code: "W001", balance: null }, { code: "W002", balance: "-5" }];
    expect(applyView(rows, v, columns).map((r) => r.code)).toEqual(["W002"]);
    expect(applyView(rows, { ...v, filters: [], sort: { column: "balance", dir: "asc" } }, columns).map((r) => r.code)).toEqual(["W001", "W002"]);
  });
});
