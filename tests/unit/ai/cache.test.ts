import { expect, it } from "vitest";
import { proposalCacheKey, duplicatePolicyWarnings } from "@/core/ai/cache";
it("binds proposal cache to company, clauses, provider/model routing, prompt and schema", () => {
  const context = { companyId: "a", clauseHash: "h", provider: "provider", models: ["model"], promptVersion: "v1", schemaVersion: "1" };
  const hash = proposalCacheKey(context);
  for (const change of [{ companyId: "b" }, { clauseHash: "other" }, { provider: "other" }, { models: ["new"] }, { promptVersion: "v2" }, { schemaVersion: "2" }]) expect(proposalCacheKey({ ...context, ...change })).not.toBe(hash);
});
it("labels exact and near duplicates only as warnings", () => {
  const clauses = [{ id: "C1", text: "Employees may receive overtime for approved hours at two times the hourly rate." }, { id: "C2", text: "Employees may receive overtime for approved hours at two times the hourly rate." }];
  expect(duplicatePolicyWarnings(clauses, []).join(" ")).toContain("exact duplicate");
  expect(duplicatePolicyWarnings([clauses[0]], [{ version: 2, clauses: [{ id: "old", text: "Employees may receive overtime for approved hours at two times their hourly rate." }] }]).join(" ")).toContain("near duplicate");
});
