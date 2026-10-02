// Validate-repair pipeline (rule 1, acceptance 1-2): ACCEPTED, REPAIRED, bounded retries, outage, declined.
import { describe, expect, it } from "vitest";
import { runValidated } from "@/core/ai";
import { policyInput } from "@/core/ai/inputs/policy";
import { policySpec } from "@/core/ai/policy";
import { splitPolicy } from "@/core/config";
import { GOOD, POLICY_TEXT, scripted } from "../../fixtures/ai/policy";

const clauses = splitPolicy(POLICY_TEXT);
const run = (answers: Parameters<typeof scripted>[0]) => {
  const p = scripted(answers);
  return runValidated(p, policySpec(clauses), policyInput(clauses, "ref")).then((r) => ({ r, p }));
};

describe("policy interpreter pipeline", () => {
  it("splits policy text into numbered clauses and drops list markers", () => {
    expect(clauses.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(clauses[0].text.startsWith("Full-time")).toBe(true);
  });

  it("a valid answer is ACCEPTED on the first try with no flags", async () => {
    const { r, p } = await run([GOOD]);
    expect(r).toMatchObject({ status: "ACCEPTED", retries: 0, flags: [], problems: [] });
    expect(p.calls).toHaveLength(1);
  });

  it("malformed JSON is repaired once, then REPAIRED", async () => {
    const { r, p } = await run(["not json", GOOD]);
    expect(r).toMatchObject({ status: "REPAIRED", retries: 1 });
    expect(p.calls[1].repair).toEqual(["the answer is not valid JSON"]);
  });

  it("an unknown rule ID or an unknown clause is repaired, never accepted as is", async () => {
    const badRule = { ...GOOD, params: { ...GOOD.params!, rules: [{ ruleId: "BONUS", clauseIds: ["C1"] }] } };
    const badClause = { ...GOOD, params: { ...GOOD.params!, rules: [{ ruleId: "BASE_SALARY", clauseIds: ["C9"] }] } };
    expect((await run([badRule, GOOD])).r.status).toBe("REPAIRED");
    expect((await run([badClause, GOOD])).r.status).toBe("REPAIRED");
  });

  it("three bad answers (original + 2 repairs) end in NEEDS_HUMAN_REVIEW", async () => {
    const { r, p } = await run(["nope"]);
    expect(r).toMatchObject({ status: "NEEDS_HUMAN_REVIEW", output: null, retries: 2 });
    expect(p.calls).toHaveLength(3);
  });

  it("a provider outage is NEEDS_HUMAN_REVIEW, not a crash", async () => {
    const { r } = await run([new Error("boom")]);
    expect(r).toMatchObject({ status: "NEEDS_HUMAN_REVIEW", problems: ["the AI service is unavailable"] });
  });

  it("the model declining is NEEDS_HUMAN_REVIEW with its reasons", async () => {
    const { r, p } = await run([{ outcome: "NEEDS_HUMAN_REVIEW", reasons: ["overtime rate is missing"], params: null }]);
    expect(r).toMatchObject({ status: "NEEDS_HUMAN_REVIEW", problems: ["overtime rate is missing"] });
    expect(p.calls).toHaveLength(1);
  });

  it("a zero threshold next to an overtime rule is a claim, so it is flagged (a real model did this)", async () => {
    const zero = { ...GOOD, params: { ...GOOD.params!, weeklyOvertimeThresholdHours: "0" } };
    expect((await run([zero])).r.flags).toEqual(["weeklyOvertimeThresholdHours = 0 is not stated in the cited clauses"]);
  });

  it("a value the cited clauses do not state is flagged for HR, not silently accepted", async () => {
    const guessed = { ...GOOD, params: { ...GOOD.params!, overtimeMultiplier: "2" } };
    const { r } = await run([guessed]);
    expect(r.status).toBe("ACCEPTED");
    expect(r.flags).toEqual(["overtimeMultiplier = 2 is not stated in the cited clauses"]);
  });
});
