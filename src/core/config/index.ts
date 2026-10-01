import { z } from "zod";

// Rule catalog (ARCHITECTURE 6). Extensible in code only; AI cannot add rule types (rule 3).
export const RULE_IDS = ["BASE_SALARY", "HOURLY_RATE", "FIXED_RETAINER", "OVERTIME", "PAID_LEAVE", "UNPAID_LEAVE", "PERCENT_DEDUCTION"] as const;
export type RuleId = (typeof RULE_IDS)[number];

const decimal = z.string().regex(/^\d+(\.\d+)?$/, "decimal number");
const between = (lo: number, hi: number) => decimal.refine((v) => Number(v) >= lo && Number(v) <= hi, `must be ${lo}-${hi}`);

// Numbers are decimal strings (never floats). Percentages 0-100, multipliers 1-3 (S35).
export const ConfigParamsSchema = z
  .object({
    scheduledHoursPerPeriod: decimal.refine((v) => Number(v) > 0, "must be > 0"),
    weeklyOvertimeThresholdHours: decimal,
    overtimeMultiplier: between(1, 3),
    hourlyCapHours: decimal.nullable(),
    aboveCapMultiplier: between(1, 3),
    deductions: z.array(z.object({ code: z.string().regex(/^[A-Z_]{2,20}$/), label: z.string().min(1).max(60), percent: between(0, 100) }).strict()).max(10),
    varianceTolerance: decimal,
    rules: z.array(z.object({ ruleId: z.enum(RULE_IDS), clauseIds: z.array(z.string()).min(1) }).strict()),
  })
  .strict();
export type ConfigParams = z.infer<typeof ConfigParamsSchema>;

/** Policy text is stored as numbered clauses; every proposed rule cites clause IDs (ARCHITECTURE 6). */
export const ClausesSchema = z.array(z.object({ id: z.string().min(1), text: z.string().min(1).max(2000) }).strict()).max(200);
export type Clauses = z.infer<typeof ClausesSchema>;

export interface PayrollConfig extends ConfigParams {
  version: number;
}

/** Semantic check before a config can leave DRAFT: cited clauses exist, no duplicate deduction codes. */
export function configProblems(params: ConfigParams, clauses: Clauses): string[] {
  const ids = new Set(clauses.map((c) => c.id));
  const problems: string[] = [];
  for (const r of params.rules) for (const c of r.clauseIds) if (!ids.has(c)) problems.push(`rule ${r.ruleId} cites unknown clause ${c}`);
  const codes = params.deductions.map((d) => d.code);
  if (new Set(codes).size !== codes.length) problems.push("duplicate deduction code");
  return problems;
}
