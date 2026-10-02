import { z } from "zod";

// Company profile (P3b): what the onboarding wizard and company settings collect. Currency is always USD.
// Legal entity name, address, tax ID and logo come later (encrypted, Owner-only).
export const SIZE_RANGES = { "1_10": "1–10 people", "11_50": "11–50 people", "51_200": "51–200 people", "201_1000": "201–1,000 people", "1000_PLUS": "More than 1,000" } as const;
export const INDUSTRIES = {
  SOFTWARE: "Software and technology",
  AGENCY: "Agency or consulting",
  FINANCE: "Finance and accounting",
  HEALTHCARE: "Healthcare",
  EDUCATION: "Education",
  RETAIL: "Retail and e-commerce",
  CONSTRUCTION: "Construction",
  MANUFACTURING: "Manufacturing",
  NONPROFIT: "Non-profit",
  OTHER: "Something else",
} as const;
export const PAY_FREQUENCIES = { WEEKLY: "Every week", BIWEEKLY: "Every two weeks", SEMI_MONTHLY: "Twice a month", MONTHLY: "Once a month" } as const;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type SizeRange = keyof typeof SIZE_RANGES;
export type Industry = keyof typeof INDUSTRIES;
export type PayFrequency = keyof typeof PAY_FREQUENCIES;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const isCountry = (c: string) => {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(c);
    return !!name && name !== "Unknown Region";
  } catch {
    return false;
  }
};

const name = z.string().trim().min(1).max(120);
const country = z.string().length(2).refine(isCountry, "unknown country");
const timezone = z.string().min(3).max(64).refine(isTimeZone, "unknown time zone");
const sizeRange = z.enum(Object.keys(SIZE_RANGES) as [SizeRange, ...SizeRange[]]);
const industry = z.enum(Object.keys(INDUSTRIES) as [Industry, ...Industry[]]);
const payFrequency = z.enum(Object.keys(PAY_FREQUENCIES) as [PayFrequency, ...PayFrequency[]]);

export const BasicsSchema = z.object({ name, country, timezone, sizeRange, industry }).strict();

/** Pay day: day of the month for monthly pay (1–28, or 31 for the last day), a weekday (1 = Monday … 7) for weekly and every-two-weeks pay, none for twice a month. */
export const ScheduleSchema = z
  .object({ payFrequency, payDay: z.number().int().nullable() })
  .strict()
  .refine(
    (s) =>
      s.payFrequency === "SEMI_MONTHLY" ? s.payDay === null : s.payFrequency === "MONTHLY" ? s.payDay !== null && ((s.payDay >= 1 && s.payDay <= 28) || s.payDay === 31) : s.payDay !== null && s.payDay >= 1 && s.payDay <= 7,
    { message: "pay day does not fit the pay frequency", path: ["payDay"] },
  );

export type Basics = z.infer<typeof BasicsSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;

export interface CompanyProfile {
  name: string | null;
  country: string | null;
  timezone: string | null;
  sizeRange: string | null;
  industry: string | null;
  payFrequency: string | null;
  payDay: number | null;
}

/** The wizard is finished when both the basics and the pay schedule are saved. */
export const profileComplete = (p: CompanyProfile) =>
  BasicsSchema.safeParse({ name: p.name, country: p.country, timezone: p.timezone, sizeRange: p.sizeRange, industry: p.industry }).success &&
  ScheduleSchema.safeParse({ payFrequency: p.payFrequency, payDay: p.payDay }).success;

export const countryName = (code: string) => new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;

export function payDayLabel(frequency: string | null, day: number | null): string {
  if (frequency === "SEMI_MONTHLY") return "the 15th and the last day";
  if (day === null) return "–";
  if (frequency === "MONTHLY") return day === 31 ? "the last day of the month" : `day ${day} of the month`;
  return WEEKDAYS[day - 1] ?? "–";
}

const A = "A".charCodeAt(0);
/** Every region the runtime knows, as { code, name } sorted by name (for the country select). */
export function countryOptions(): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  for (let i = 0; i < 26; i++)
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (isCountry(code)) out.push({ code, name: countryName(code) });
    }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

export const timezoneOptions = (): string[] => Intl.supportedValuesOf("timeZone");
