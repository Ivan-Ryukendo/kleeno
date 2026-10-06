import { z } from "zod";
import { div, formatUsdc, mul, parseDecimal, parseUsdc, ratio, type Ratio } from "../money";

const quantity = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
export const resourceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "use a valid calendar date");
const metricId = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/);
const inputRule = z.object({ kind: z.literal("INPUT"), type: z.enum(["text", "number", "date"]) }).strict();
const attendanceRule = z.object({ kind: z.literal("ATTENDANCE_DAYS") }).strict();
const leaveRule = z.object({
  kind: z.literal("LEAVE_BALANCE"), unit: z.enum(["DAYS", "HOURS"]), yearStart: resourceDate, yearEnd: resourceDate,
  accrual: z.enum(["ANNUAL", "MONTHLY"]), entitlement: quantity, creditTiming: z.enum(["START", "END"]),
  carryOverCap: quantity, carryOverExpiresOn: resourceDate.nullable(),
}).strict().refine((r) => r.yearStart <= r.yearEnd && r.yearStart.endsWith("-01") &&
  new Date(`${r.yearEnd}T00:00:00Z`).getUTCDate() === new Date(Date.UTC(Number(r.yearEnd.slice(0, 4)), Number(r.yearEnd.slice(5, 7)), 0)).getUTCDate() &&
  (Date.parse(r.yearEnd) - Date.parse(r.yearStart)) / 86400000 <= 365 &&
  (!r.carryOverExpiresOn || (r.carryOverExpiresOn >= r.yearStart && r.carryOverExpiresOn <= r.yearEnd)), "leave year must use full calendar months; expiry belongs to that year");
const performanceRule = z.object({ kind: z.literal("PERFORMANCE"), metrics: z.array(z.object({ id: metricId, label: z.string().trim().min(1).max(60), weight: quantity }).strict()).min(1).max(10) }).strict()
  .refine((r) => new Set(r.metrics.map((m) => m.id)).size === r.metrics.length && r.metrics.every((m) => parseUsdc(m.weight) > 0n) && r.metrics.reduce((n, m) => n + parseUsdc(m.weight), 0n) === 100_000_000n, "unique KPI weights must sum to 100");

export const ResourceDefinitionSchema = z.object({
  label: z.string().trim().min(1).max(60),
  policy: z.object({ configVersion: z.number().int().positive(), clauseIds: z.array(z.string().regex(/^C\d+$/)).min(1).max(30) }).strict().nullable(),
  rule: z.discriminatedUnion("kind", [inputRule, attendanceRule, leaveRule, performanceRule]),
}).strict().refine((d) => d.rule.kind === "INPUT" || d.policy !== null, "computed resources need approved policy evidence");
export type ResourceDefinition = z.infer<typeof ResourceDefinitionSchema>;

const evidence = { sourceRef: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) };
const period = { periodStart: resourceDate, periodEnd: resourceDate };
const orderedPeriod = (p: { periodStart: string; periodEnd: string }) => p.periodStart <= p.periodEnd;
const inputSchema = z.object({ ...evidence, value: z.string().max(1000) }).strict();
const attendanceSchema = z.object({ ...evidence, ...period, dates: z.array(resourceDate).max(366) }).strict().refine(orderedPeriod);
const leaveSchema = z.object({ ...evidence, openingBalance: quantity, openingAsOf: resourceDate, carryOver: quantity, used: quantity, asOf: resourceDate }).strict();
const performanceSchema = z.object({ ...evidence, ...period, metrics: z.array(z.object({ id: metricId, actual: quantity, target: quantity }).strict()).min(1).max(10) }).strict().refine(orderedPeriod);
export const ResourceInputSchema = z.union([inputSchema, attendanceSchema, leaveSchema, performanceSchema]);
export type ResourceInput = z.infer<typeof ResourceInputSchema>;
export interface ResourceCell {
  value: string | null;
  status: "VERIFIED" | "DATA_REQUIRED";
  formula: string;
  sources: string[];
  editable: boolean;
  unit?: string;
  inputRevision?: { id: string; version: number; createdAt: string };
}

export function resourceFormula(d: ResourceDefinition): string {
  switch (d.rule.kind) {
    case "INPUT": return "HR-reviewed source value";
    case "ATTENDANCE_DAYS": return "Count distinct approved attendance dates within the evidence period";
    case "LEAVE_BALANCE": return `Opening balance + ${d.rule.accrual === "ANNUAL" ? "annual entitlement" : "credited months × annual entitlement ÷ 12"} + eligible capped carry-over − approved usage (${d.rule.unit.toLowerCase()})`;
    case "PERFORMANCE": return d.rule.metrics.length === 1 ? "Actual ÷ target × 100 (%)" : "Sum of (actual ÷ target × KPI weight), with weights totaling 100 (%)";
  }
}

const rounded = (r: Ratio) => formatUsdc((r.n + r.d / 2n) / r.d);
const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);

/** Supported data formulas only. Missing/invalid evidence never becomes a manufactured result or payroll input. */
export function evaluateResource(rawDefinition: ResourceDefinition, raw: unknown): ResourceCell {
  const parsed = ResourceDefinitionSchema.safeParse(rawDefinition);
  const d = parsed.success ? parsed.data : rawDefinition;
  const unavailable: ResourceCell = { value: null, status: "DATA_REQUIRED", formula: parsed.success ? resourceFormula(d) : "Policy definition requires review", sources: [], editable: true };
  if (!parsed.success || raw === null || raw === undefined) return unavailable;
  const source = ResourceInputSchema.safeParse(raw);
  if (!source.success) return unavailable;
  const verified = (value: string, unit?: string): ResourceCell => ({ ...unavailable, value, status: "VERIFIED", sources: [source.data.sourceRef, ...(d.policy ? d.policy.clauseIds.map((id) => `Configuration v${d.policy!.configVersion} / ${id}`) : [])], unit });
  switch (d.rule.kind) {
    case "INPUT": {
      const p = inputSchema.safeParse(raw);
      if (!p.success || !p.data.value.trim() || (d.rule.type === "number" && !quantity.safeParse(p.data.value).success) || (d.rule.type === "date" && !resourceDate.safeParse(p.data.value).success)) return unavailable;
      return verified(p.data.value);
    }
    case "ATTENDANCE_DAYS": {
      const p = attendanceSchema.safeParse(raw);
      if (!p.success || p.data.dates.some((date) => date < p.data.periodStart || date > p.data.periodEnd)) return unavailable;
      return verified(String(new Set(p.data.dates).size), "days");
    }
    case "LEAVE_BALANCE": {
      const p = leaveSchema.safeParse(raw);
      const r = d.rule;
      if (!p.success || p.data.asOf < r.yearStart || p.data.asOf > r.yearEnd || p.data.openingAsOf > p.data.asOf || p.data.openingAsOf < new Date(Date.parse(r.yearStart) - 86400000).toISOString().slice(0, 10)) return unavailable;
      const { asOf, openingAsOf } = p.data;
      const creditDates: string[] = [];
      if (r.accrual === "ANNUAL") creditDates.push(r.creditTiming === "START" ? r.yearStart : r.yearEnd);
      else {
        const cursor = new Date(`${r.yearStart}T00:00:00Z`);
        while (cursor.toISOString().slice(0, 10) <= r.yearEnd) {
          const date = r.creditTiming === "START" ? cursor : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
          creditDates.push(date.toISOString().slice(0, 10));
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      }
      const credits = creditDates.filter((date) => date > openingAsOf && date <= asOf).length;
      const grant = ratio(parseUsdc(r.entitlement) * BigInt(credits), r.accrual === "MONTHLY" ? 12n : 1n);
      const carry = r.carryOverExpiresOn && asOf > r.carryOverExpiresOn ? 0n : (parseUsdc(p.data.carryOver) < parseUsdc(r.carryOverCap) ? parseUsdc(p.data.carryOver) : parseUsdc(r.carryOverCap));
      const balance = add(ratio(parseUsdc(p.data.openingBalance) + carry - parseUsdc(p.data.used)), grant);
      return verified(balance.n < 0n ? `-${rounded(ratio(-balance.n, balance.d))}` : rounded(balance), r.unit.toLowerCase());
    }
    case "PERFORMANCE": {
      const p = performanceSchema.safeParse(raw);
      if (!p.success || p.data.metrics.length !== d.rule.metrics.length || new Set(p.data.metrics.map((m) => m.id)).size !== p.data.metrics.length) return unavailable;
      let score = ratio(0n);
      for (const metric of d.rule.metrics) {
        const m = p.data.metrics.find((x) => x.id === metric.id);
        if (!m || parseUsdc(m.target) === 0n) return unavailable;
        score = add(score, mul(div(parseDecimal(m.actual), parseDecimal(m.target)), ratio(parseUsdc(metric.weight))));
      }
      return verified(rounded(score), "%");
    }
  }
}
