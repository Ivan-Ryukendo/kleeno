// Waitlist + lead list domain (docs/phases/W.md). Stable codes are stored; labels are for display only.
import { z } from "zod";

const options = <T extends string>(labels: Record<T, string>) => Object.keys(labels) as [T, ...T[]];

export const ROLE_LABELS = {
  PAYROLL: "Payroll",
  FINANCE: "Finance / controller",
  ACCOUNTING_AGENCY: "Payroll bureau or accounting firm",
  FOUNDER_OPERATIONS: "Founder / operations",
  OTHER: "Other",
} as const;
export const SIZE_LABELS = { "1_10": "1–10", "11_50": "11–50", "51_200": "51–200", "201_1000": "201–1,000", "1000_PLUS": "1,000+" } as const;
export const PAIN_LABELS = {
  RECONCILIATION: "Reconciling payroll data and finding discrepancies",
  CONFIGURATION: "Configuring and maintaining pay rules",
  CONTRACTOR_PAYMENTS: "Managing remote contractor payments",
  AUDITABILITY: "Explaining calculations and keeping audit trails",
  MANUAL_ADMIN: "Manual spreadsheets and repetitive admin",
  OTHER: "Other, or no major problem",
} as const;
export const BUDGET_LABELS = {
  FREE_ONLY: "Only a free tool",
  UNDER_100: "Under $100 / month",
  "100_299": "$100–299 / month",
  "300_499": "$300–499 / month",
  "500_PLUS": "$500+ / month",
  UNSURE: "Not sure yet",
} as const;
export const STATUS_LABELS = {
  NEW: "New",
  QUALIFIED: "Qualified",
  CALL_SCHEDULED: "Call scheduled",
  CALL_DONE: "Call done",
  PILOT_CANDIDATE: "Pilot candidate",
  CLOSED: "Closed",
  UNSUBSCRIBED: "Unsubscribed",
} as const;

export type Role = keyof typeof ROLE_LABELS;
export type CompanySize = keyof typeof SIZE_LABELS;
export type PainPoint = keyof typeof PAIN_LABELS;
export type BudgetBand = keyof typeof BUDGET_LABELS;
export type LeadStatus = keyof typeof STATUS_LABELS;
export const ROLES = options(ROLE_LABELS);
export const SIZES = options(SIZE_LABELS);
export const PAINS = options(PAIN_LABELS);
export const BUDGETS = options(BUDGET_LABELS);
export const STATUSES = options(STATUS_LABELS);

/** Admin actions name what happens, never a raw target state (S14); each maps to exactly one status. */
export const LEAD_ACTIONS = {
  QUALIFY: "QUALIFIED",
  SCHEDULE_CALL: "CALL_SCHEDULED",
  CALL_DONE: "CALL_DONE",
  MARK_PILOT: "PILOT_CANDIDATE",
  CLOSE: "CLOSED",
  UNSUBSCRIBE: "UNSUBSCRIBED",
  REOPEN: "NEW",
} as const satisfies Record<string, LeadStatus>;
export type LeadAction = keyof typeof LEAD_ACTIONS;

// Bump when the consent sentence changes; every contact stores the version it agreed to.
export const CONSENT_VERSION = "2026-10-01";
export const CONSENT_TEXT = "Email me when Kleeno is ready, including pricing and early-access offers. I can unsubscribe at any time.";

export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

const text = (max: number) => z.string().trim().min(1).max(max);
const attribution = z.string().trim().max(100).regex(/^[\w .:/@+-]*$/).optional();
const profile = {
  role: z.enum(ROLES).optional(),
  companyName: text(120).optional(),
  companySize: z.enum(SIZES).optional(),
  painPoint: z.enum(PAINS).optional(),
  budgetBand: z.enum(BUDGETS).optional(),
  wantsCall: z.boolean().optional(),
};

/** Public sign-up. Survey fields are optional, so one schema serves email-first and the combined form. */
export const JoinBody = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    consent: z.literal(true),
    website: z.string().max(200).optional(), // honeypot: people never see it, bots fill it
    elapsedMs: z.number().int().min(0).max(86_400_000), // time the form was open
    source: attribution,
    utmSource: attribution,
    utmMedium: attribution,
    utmCampaign: attribution,
    ...profile,
  })
  .strict();
export type JoinBody = z.infer<typeof JoinBody>;

export const SurveyBody = z.object({ token: z.string().regex(/^[\w-]{43}$/), ...profile }).strict();
export type SurveyBody = z.infer<typeof SurveyBody>;

export const MIN_FILL_MS = 1500; // ponytail: a timing check stops naive bots only; add Turnstile if spam gets through

export const hasSurvey = (b: Pick<JoinBody, "painPoint" | "budgetBand" | "wantsCall">) =>
  b.painPoint !== undefined || b.budgetBand !== undefined || b.wantsCall !== undefined;

// ---- Metrics (S58): real, non-test records only; every rate names its denominator and is null when it is 0.

export interface LeadRow {
  status: LeadStatus;
  is_test: boolean;
  role: Role | null;
  source: string | null;
  utm_source: string | null;
  surveys: { pain_point: PainPoint | null; budget_band: BudgetBand | null; wants_call: boolean | null } | null;
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);
const tally = <K extends string>(keys: readonly K[], values: (K | null | undefined)[]) =>
  Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length])) as Record<K, number>;
const countBy = (values: string[]) =>
  Object.entries(values.reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);

export function leadMetrics(all: LeadRow[]) {
  const rows = all.filter((r) => !r.is_test);
  const surveyed = rows.filter((r) => r.surveys);
  const byStatus = tally(STATUSES, rows.map((r) => r.status));
  const hadCall = byStatus.CALL_DONE + byStatus.PILOT_CANDIDATE;
  const wantsCall = rows.filter((r) => r.surveys?.wants_call === true).length;
  return {
    signups: rows.length,
    surveyed: surveyed.length,
    surveyRate: rate(surveyed.length, rows.length), // contacts with a survey ÷ sign-ups
    wantsCall,
    wantsCallRate: rate(wantsCall, rows.length), // "yes" to a call ÷ sign-ups
    byStatus,
    callToPilot: rate(byStatus.PILOT_CANDIDATE, hadCall), // pilot candidates ÷ (call done + pilot candidates), by current status
    pains: tally(PAINS, surveyed.map((r) => r.surveys!.pain_point)),
    budgets: tally(BUDGETS, surveyed.map((r) => r.surveys!.budget_band)),
    roles: tally(ROLES, rows.map((r) => r.role)),
    sources: countBy(rows.map((r) => r.utm_source ?? r.source ?? "direct")),
  };
}
export type LeadMetrics = ReturnType<typeof leadMetrics>;

// ---- CSV export (S56): every cell quoted; cells a spreadsheet would run as a formula get a leading apostrophe.

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
