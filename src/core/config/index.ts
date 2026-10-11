import { z } from "zod";
import { canonicalHash } from "../canonical";
import { createHash } from "node:crypto";

// Rule catalog (ARCHITECTURE 6). Extensible in code only; AI cannot add rule types (rule 3).
export const RULE_IDS = ["BASE_SALARY", "HOURLY_RATE", "FIXED_RETAINER", "OVERTIME", "PAID_LEAVE", "UNPAID_LEAVE", "PERCENT_DEDUCTION", "ONE_OFF_ADDITION", "FIXED_DEDUCTION", "PRORATION"] as const;
export type RuleId = (typeof RULE_IDS)[number];

const decimal = z.string().regex(/^\d+(\.\d+)?$/, "decimal number");
const between = (lo: number, hi: number) => decimal.refine((v) => Number(v) >= lo && Number(v) <= hi, `must be ${lo}-${hi}`);

// Numbers are decimal strings (never floats). Percentages 0-100, multipliers 1-3 (S35).
const ConfigValuesSchema = z
  .object({
    scheduledHoursPerPeriod: decimal.refine((v) => Number(v) > 0, "must be > 0"),
    weeklyOvertimeThresholdHours: decimal,
    overtimeMultiplier: between(1, 3),
    hourlyCapHours: decimal.nullable(),
    aboveCapMultiplier: between(1, 3),
    deductions: z.array(z.object({ code: z.string().regex(/^[A-Z_]{2,20}$/), label: z.string().min(1).max(60), percent: between(0, 100) }).strict()).max(10),
    varianceTolerance: decimal,
  })
  .strict();
export const ScopeSchema = z.object({
  workers: z.array(z.string().min(1).max(80)).min(1).max(1000).optional(),
  groups: z.array(z.object({ field: z.enum(["payType", "workerType", "department", "tag"]), value: z.string().trim().min(1).max(80) }).strict().refine(g => g.field !== "payType" || ["SALARIED", "HOURLY", "RETAINER"].includes(g.value), "unknown pay type").refine(g => g.field !== "workerType" || ["EMPLOYEE", "CONTRACTOR"].includes(g.value), "unknown worker type")).min(1).max(20).optional(),
}).strict().refine(s => !(s.workers && s.groups), "use listed workers or groups, not both").refine(s => !s.workers || new Set(s.workers).size === s.workers.length, "duplicate workers").refine(s => !s.groups || new Set(s.groups.map(g => `${g.field}:${g.value}`)).size === s.groups.length, "duplicate group selector");
export const ScopedRuleSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), scope: ScopeSchema, values: ConfigValuesSchema.omit({ varianceTolerance: true }).partial().refine(v => Object.keys(v).length > 0, "rule needs a supported value"), clauseIds: z.array(z.string().min(1)).min(1).max(500) }).strict();
export const ConfigParamsSchema = ConfigValuesSchema.extend({
  rules: z.array(z.object({ ruleId: z.enum(RULE_IDS), clauseIds: z.array(z.string().min(1)).min(1).max(500) }).strict()).max(100),
  scopedRules: z.array(ScopedRuleSchema).max(100).optional(),
  prorationMethod: z.enum(["NONE", "ACTUAL_CALENDAR_DAYS"]).optional(),
}).strict();
export type ConfigParams = z.infer<typeof ConfigParamsSchema>;

/** Policy text is stored as numbered clauses; every proposed rule cites clause IDs (ARCHITECTURE 6). */
export const ClausesSchema = z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(2000) }).strict()).max(500).refine(cs => cs.reduce((n, c) => n + c.text.length, 0) <= 40000, "policy exceeds 40,000 characters").refine(cs => new Set(cs.map(c => c.id)).size === cs.length, "duplicate clause ID");
export type Clauses = z.infer<typeof ClausesSchema>;
export const PolicyDocumentsSchema = z.array(z.object({
  id: z.string().uuid(), format: z.enum(["txt", "md", "docx", "pdf"]), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  clauses: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(2000), anchor: z.string().regex(/^(?:page:[1-9]\d{0,2}:paragraph:[1-9]\d*|(?:reviewed:)?paragraph:[1-9]\d*)$/).max(80).refine(a => !a.startsWith("page:") || Number(a.split(":")[1]) <= 100, "page exceeds 100") }).strict()).min(1).max(500),
}).strict()).max(10).refine(ds => new Set(ds.map(d => d.id)).size === ds.length, "duplicate document ID")
  .refine(ds => ds.reduce((total, d) => total + d.clauses.length, 0) <= 500, "policy exceeds 500 clauses")
  .refine(ds => ds.reduce((total, d) => total + d.clauses.reduce((chars, clause) => chars + clause.text.length, 0), 0) <= 40000, "policy exceeds 40,000 characters");
export type PolicyDocuments = z.infer<typeof PolicyDocumentsSchema>;
export function validatedPolicyDocuments(policyText: string, input: unknown): { documents: PolicyDocuments; clauses: Clauses } {
  const documents = PolicyDocumentsSchema.parse(input);
  const normalize = (s: string) => s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  for (const d of documents) if (createHash("sha256").update(normalize(d.clauses.map(c => c.text).join("\n"))).digest("hex") !== d.contentHash) throw new Error("policy document hash mismatch");
  const clauses = ClausesSchema.parse(documents.flatMap(d => d.clauses.map(c => ({ id: c.id, text: c.text }))));
  if (normalize(policyText) !== clauses.map(c => c.text).join("\n")) throw new Error("policy text and reviewed documents do not match");
  return { documents, clauses };
}

/** Policy text -> numbered clauses (C1, C2...), one per non-empty line; a leading "1." or "-" is dropped. Too long or too many -> error. */
export function splitPolicy(text: string): Clauses {
  if (text.length > 40000) throw new Error("policy exceeds 40,000 characters");
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  return ClausesSchema.parse(lines.map((t, i) => ({ id: `C${i + 1}`, text: t })));
}

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
  const scoped = params.scopedRules ?? [];
  if (new Set(scoped.map(r => r.id)).size !== scoped.length) problems.push("duplicate scoped rule ID");
  for (const r of scoped) {
    for (const c of r.clauseIds) if (!ids.has(c)) problems.push(`rule ${r.id} cites unknown clause ${c}`);
    const dc = r.values.deductions?.map(d => d.code) ?? [];
    if (new Set(dc).size !== dc.length) problems.push(`rule ${r.id}: duplicate deduction code`);
  }
  return problems;
}

export interface ScopeWorker { workerId: string; pseudonym?: string; payType: string; workerType?: string | null; department?: string | null; tags?: string[] }
export type ScopeCategory = "COMPANY" | "MULTI_GROUP" | "GROUP" | "PERSONAL";
export function scopeCategory(scope: { workers?: string[]; groups?: unknown[] }): ScopeCategory {
  return scope.workers?.length ? "PERSONAL" : (scope.groups?.length ?? 0) > 1 ? "MULTI_GROUP" : scope.groups?.length ? "GROUP" : "COMPANY";
}
const ranks: Record<ScopeCategory, number> = { COMPANY: 0, MULTI_GROUP: 1, GROUP: 2, PERSONAL: 3 };
const applies = (scope: z.infer<typeof ScopeSchema>, w: ScopeWorker) => scope.workers ? scope.workers.some(id => id === w.workerId || id === w.pseudonym) : !scope.groups || scope.groups.some(g => g.field === "tag" ? w.tags?.includes(g.value) : w[g.field] === g.value);
export interface ScopeDecision { parameter: string; winner: string; overridden: string[]; category: ScopeCategory }
/** Groups are a union of explicit field/tag selectors. A one-group rule is more specific than a multi-group union. */
export function resolveScopedConfig<T extends Partial<ConfigParams>>(config: T, worker: ScopeWorker): { config: T; decisions: ScopeDecision[] } {
  const rules = (config.scopedRules ?? []).filter(r => applies(r.scope, worker)).sort((a, b) => ranks[scopeCategory(a.scope)] - ranks[scopeCategory(b.scope)] || a.id.localeCompare(b.id));
  const values: Record<string, unknown> = { ...config };
  const decisions: ScopeDecision[] = [];
  for (const parameter of new Set(rules.flatMap(r => Object.keys(r.values)))) {
    const candidates = rules.filter(r => parameter in r.values);
    for (const rank of [0, 1, 2, 3]) {
      const peers = candidates.filter(r => ranks[scopeCategory(r.scope)] === rank);
      if (new Set(peers.map(r => canonicalHash(r.values[parameter as keyof typeof r.values]))).size > 1) throw new Error(`equal-rank clash for ${parameter} (${peers.map(r => r.id).join(", ")})`);
    }
    const winner = candidates[candidates.length - 1];
    values[parameter] = winner.values[parameter as keyof typeof winner.values];
    const overridden = candidates.filter(r => r !== winner).map(r => r.id);
    if (scopeCategory(winner.scope) !== "COMPANY" && !candidates.some(r => scopeCategory(r.scope) === "COMPANY")) overridden.unshift("company-default");
    decisions.push({ parameter, winner: winner.id, overridden, category: scopeCategory(winner.scope) });
  }
  return { config: values as T, decisions };
}
export function scopeReview(config: ConfigParams, workers: ScopeWorker[]) {
  const problems: string[] = [], warnings: string[] = [], overrides: { workerId: string; parameter: string; winner: string; overridden: string[] }[] = [];
  const coverage: { workerId: string; ruleIds: string[] }[] = [];
  for (const w of workers) {
    const applicable = (config.scopedRules ?? []).filter(r => applies(r.scope, w));
    coverage.push({ workerId: w.workerId, ruleIds: applicable.map(r => r.id) });
    try { for (const d of resolveScopedConfig(config, w).decisions) if (d.overridden.length) overrides.push({ workerId: w.workerId, ...d }); }
    catch (e) { problems.push(`${w.workerId}: ${e instanceof Error ? e.message : "scope conflict"}`); }
    if (config.scopedRules?.length && !applicable.length) warnings.push(`${w.workerId}: no scoped rule covers this worker; company values apply`);
  }
  for (const r of config.scopedRules ?? []) if (!workers.some(w => applies(r.scope, w))) warnings.push(`${r.id}: no worker matches this scope`);
  const keys = new Set<string>();
  for (const r of config.scopedRules ?? []) {
    const key = canonicalHash({ scope: r.scope, parameters: Object.keys(r.values).sort() });
    if (keys.has(key)) warnings.push(`${r.id}: duplicate rule scope`);
    keys.add(key);
  }
  return { problems, warnings, overrides, coverage };
}
export const scopeOverrideKey = (o: { workerId: string; parameter: string; winner: string; overridden: string[] }) => canonicalHash({ workerId: o.workerId, parameter: o.parameter, winner: o.winner, overridden: o.overridden });
