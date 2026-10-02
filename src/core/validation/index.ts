import { configProblems, type Clauses, type ConfigParams, type RuleId } from "../config";

// Schema, semantic and evidence validators. The AI pipeline calls these, never the reverse (S22).

/** AI text is data: no links, addresses or markup, so it can never carry a payment target or script (S23, rule 6). */
const UNSAFE_TEXT = /https?:\/\/|www\.|0x[0-9a-fA-F]{20,}|<\s*[a-zA-Z!/]|javascript:/i;
export const plainTextProblems = (label: string, texts: string[]): string[] =>
  texts.flatMap((t, i) => (UNSAFE_TEXT.test(t) ? [`${label}[${i}] contains a link, address or markup`] : []));

export interface ConfigValidation {
  problems: string[]; // block the proposal
  flags: string[]; // values the cited clauses do not support: HR must confirm each one (ARCHITECTURE 7)
}

const numbersIn = (text: string) => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Semantic + evidence checks for a proposed config. Numbers are never invented silently: unsupported ones are flagged. */
export function validateConfigProposal(params: ConfigParams, clauses: Clauses): ConfigValidation {
  const problems = configProblems(params, clauses);
  const ruleIds = params.rules.map((r) => r.ruleId);
  if (new Set(ruleIds).size !== ruleIds.length) problems.push("a rule is listed twice");

  const text = (rules: RuleId[]) => {
    const cited = new Set(params.rules.filter((r) => rules.includes(r.ruleId)).flatMap((r) => r.clauseIds));
    return clauses.filter((c) => cited.has(c.id)).flatMap((c) => numbersIn(c.text));
  };
  const flags: string[] = [];
  const check = (label: string, value: string | null, rules: RuleId[], neutral: string[]) => {
    if (value === null) return;
    // A zero or default value is only neutral when no rule it belongs to is present; a "0" next to an overtime rule is a claim.
    if (!rules.some((r) => ruleIds.includes(r)) && (neutral.includes(value) || Number(value) === 0)) return;
    if (!text(rules).includes(Number(value))) flags.push(`${label} = ${value} is not stated in the cited clauses`);
  };
  check("scheduledHoursPerPeriod", params.scheduledHoursPerPeriod, ["BASE_SALARY", "HOURLY_RATE", "OVERTIME", "PAID_LEAVE", "UNPAID_LEAVE"], []); // any hours-related rule may cite it
  check("weeklyOvertimeThresholdHours", params.weeklyOvertimeThresholdHours, ["OVERTIME"], []);
  check("overtimeMultiplier", params.overtimeMultiplier, ["OVERTIME"], ["1", "1.0"]);
  check("hourlyCapHours", params.hourlyCapHours, ["OVERTIME", "HOURLY_RATE"], []);
  if (params.hourlyCapHours !== null) check("aboveCapMultiplier", params.aboveCapMultiplier, ["OVERTIME", "HOURLY_RATE"], ["1", "1.0"]); // no cap: the multiplier is unused
  for (const d of params.deductions) check(`deduction ${d.code}`, d.percent, ["PERCENT_DEDUCTION"], []);
  check("varianceTolerance", params.varianceTolerance, [], ["0.01"]);
  if (params.deductions.length && !ruleIds.includes("PERCENT_DEDUCTION")) problems.push("deductions need a PERCENT_DEDUCTION rule citing a clause");
  return { problems, flags };
}
