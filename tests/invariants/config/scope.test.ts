import { describe, expect, it } from "vitest";
import { ConfigParamsSchema, resolveScopedConfig, scopeCategory, scopeReview, splitPolicy } from "@/core/config";
import { CONFIG } from "../../fixtures/payroll/cases";

const worker = { workerId: "w1", payType: "SALARIED" as const, department: "Engineering", workerType: "EMPLOYEE", tags: ["remote"] };
const scoped = (id: string, scope: Record<string, unknown>, multiplier: string) => ({ id, scope, values: { overtimeMultiplier: multiplier }, clauseIds: ["C1"] });
describe("deterministic scope precedence", () => {
  it("rejects scoped variance tolerance rather than silently applying a global tolerance", () => {
    const { version: _version, ...params } = CONFIG;
    void _version;
    expect(ConfigParamsSchema.safeParse({ ...params, scopedRules: [{ id: "variance", scope: { workers: ["w1"] }, values: { varianceTolerance: "1" }, clauseIds: ["C1"] }] }).success).toBe(false);
  });
  it("derives categories from selectors; personal > group > multi-group > company", () => {
    const rules = [scoped("company", {}, "1"), scoped("multi", { groups: [{ field: "department", value: "Engineering" }, { field: "tag", value: "remote" }] }, "1.5"), scoped("group", { groups: [{ field: "department", value: "Engineering" }] }, "2"), scoped("personal", { workers: ["w1"] }, "3")];
    const config = { ...CONFIG, scopedRules: rules };
    expect(scopeCategory(rules[2].scope)).toBe("GROUP");
    expect(resolveScopedConfig(config, worker).config.overtimeMultiplier).toBe("3");
    expect(resolveScopedConfig(config, worker).decisions[0]).toMatchObject({ winner: "personal", overridden: ["company", "multi", "group"] });
    expect(scopeReview(config, [worker]).overrides).toHaveLength(1);
  });
  it("blocks equal rank disagreements and reports uncovered target selectors", () => {
    const config = { ...CONFIG, scopedRules: [scoped("a", { groups: [{ field: "department", value: "Engineering" }] }, "2"), scoped("b", { groups: [{ field: "tag", value: "remote" }] }, "3"), scoped("absent", { workers: ["w2"] }, "1.5")] };
    expect(() => resolveScopedConfig(config, worker)).toThrow(/equal-rank/);
    expect(scopeReview(config, [worker]).problems.join(" ")).toContain("equal-rank");
    expect(scopeReview(config, [worker]).warnings.join(" ")).toContain("absent");
  });
  it("rejects AI-assigned rank and aligns the 500 clause bound", () => {
    expect(ConfigParamsSchema.safeParse({ ...CONFIG, version: undefined, scopedRules: [scoped("x", { kind: "PERSONAL" }, "2")] }).success).toBe(false);
    expect(splitPolicy(Array.from({ length: 500 }, () => "Policy.").join("\n"))).toHaveLength(500);
    expect(() => splitPolicy(Array.from({ length: 501 }, () => "Policy.").join("\n"))).toThrow();
  });
});
