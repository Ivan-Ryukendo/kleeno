// PROTECTED. Synthetic policy + scripted providers for AI tests (rule 42). No network, no real model.
import type { AiProvider, AiRequest } from "@/core/ai";
import type { PolicyOutput } from "@/core/ai/policy";

export const POLICY_TEXT = [
  "1. Full-time staff work 40 hours per week, 160 hours per period.",
  "2. Overtime above 40 hours a week is paid at 1.5 times the hourly rate when approved.",
  "3. Tax is withheld at 10% of gross pay.",
  "4. Paid leave is not deducted.",
].join("\n");

export const GOOD: PolicyOutput = {
  outcome: "PROPOSED",
  reasons: [],
  params: {
    scheduledHoursPerPeriod: "160",
    weeklyOvertimeThresholdHours: "40",
    overtimeMultiplier: "1.5",
    hourlyCapHours: null,
    aboveCapMultiplier: "1",
    deductions: [{ code: "TAX", label: "Tax", percent: "10" }],
    varianceTolerance: "0.01",
    rules: [
      { ruleId: "BASE_SALARY", clauseIds: ["C1"] },
      { ruleId: "OVERTIME", clauseIds: ["C2"] },
      { ruleId: "PERCENT_DEDUCTION", clauseIds: ["C3"] },
      { ruleId: "PAID_LEAVE", clauseIds: ["C4"] },
    ],
  },
};

/** Returns the scripted answers in order (strings are sent as-is, objects as JSON); throws when told to. Captures every request. */
export function scripted(answers: (string | object | Error)[]): AiProvider & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  return {
    name: "fake",
    calls,
    async complete(req) {
      calls.push(req);
      const a = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      return { text: typeof a === "string" ? a : JSON.stringify(a), model: "fake-model" };
    },
  };
}
