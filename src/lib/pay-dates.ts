import type { PayFrequency } from "@/core/company";

// Calendar preview of upcoming pay dates for company settings (display only). It follows the saved frequency and pay day literally:
// no weekend, holiday or cutoff rule is applied because the company profile stores none. Every-two-weeks schedules need a first
// period to anchor on, so they have no preview.
export interface PayDatePreview { month: string; payDate: string }

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const monthName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** `today` is a YYYY-MM-DD calendar date in the company time zone. Returns up to `count` pay dates on or after it. */
export function nextPayDates(frequency: PayFrequency | null | undefined, payDay: number | null | undefined, today: string, count = 2): PayDatePreview[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  if (frequency === "MONTHLY" && payDay) {
    for (let i = 0; out.length < count && i < 14; i++) {
      const year = y + Math.floor((m - 1 + i) / 12), month = (m - 1 + i) % 12;
      const date = iso(year, month, payDay === 31 ? lastDay(year, month) : Math.min(payDay, lastDay(year, month)));
      if (date >= today) out.push(date);
    }
  } else if (frequency === "SEMI_MONTHLY") {
    for (let i = 0; out.length < count && i < 14; i++) {
      const year = y + Math.floor((m - 1 + i) / 12), month = (m - 1 + i) % 12;
      for (const date of [iso(year, month, 15), iso(year, month, lastDay(year, month))]) if (date >= today && out.length < count) out.push(date);
    }
  } else if (frequency === "WEEKLY" && payDay && payDay >= 1 && payDay <= 7) {
    const start = new Date(Date.UTC(y, m - 1, d));
    const weekday = ((start.getUTCDay() + 6) % 7) + 1; // 1 = Monday
    start.setUTCDate(start.getUTCDate() + ((payDay - weekday + 7) % 7));
    for (let i = 0; i < count; i++) { out.push(start.toISOString().slice(0, 10)); start.setUTCDate(start.getUTCDate() + 7); }
  }
  return out.map((date) => ({ month: monthName(date), payDate: label(date) }));
}

/** Today's calendar date in an IANA zone (falls back to UTC for a missing or invalid zone). */
export function todayIn(timeZone: string | null | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
