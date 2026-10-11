import { z } from "zod";

export const TimeZoneSchema = z.string().min(1).max(64).refine(value => {
  if (value !== "UTC" && !value.includes("/")) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose an IANA timezone").transform(value => new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone);
export const TimeZonePreferenceSchema = z.object({ timezone: TimeZoneSchema.nullable() }).strict();

export function resolveTimeZone(userTimezone?: string | null, companyTimezone?: string | null): { timeZone: string; source: "user" | "company" | "utc" } {
  const user = TimeZoneSchema.safeParse(userTimezone);
  if (user.success) return { timeZone: user.data, source: "user" };
  const company = TimeZoneSchema.safeParse(companyTimezone);
  return company.success ? { timeZone: company.data, source: "company" } : { timeZone: "UTC", source: "utc" };
}

type Instant = string | number | Date;
function instantDate(instant: Instant): Date {
  // Date-only and offset-free local times are civil values, not UTC instants.
  if (typeof instant === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(instant)) throw new RangeError("An instant needs an explicit UTC or offset suffix");
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid instant");
  return date;
}

export function formatInstant(instant: Instant, timeZone: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: TimeZoneSchema.parse(timeZone) }).format(instantDate(instant));
}

export function timeZoneLabel(timeZone: string, instant: Instant = new Date()): string {
  const zone = TimeZoneSchema.parse(timeZone);
  const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(instantDate(instant)).find(part => part.type === "timeZoneName")!.value;
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const utc = match ? `UTC${match[1]}${Number(match[2])}${match[3] === "00" ? "" : `:${match[3]}`}` : "UTC";
  const city = zone === "UTC" ? "UTC" : zone.split("/").at(-1)!.replaceAll("_", " ");
  return zone === "UTC" ? "UTC" : `${utc} ${city}`;
}

/** City names come from IANA identifiers; offsets are evaluated for this instant, never stored. */
export function timeZoneOptions(instant: Instant = new Date()): { timeZone: string; city: string; label: string }[] {
  const date = instantDate(instant);
  return ["UTC", ...Intl.supportedValuesOf("timeZone")].map(timeZone => ({ timeZone, city: timeZone.split("/").at(-1)!.replaceAll("_", " "), label: timeZoneLabel(timeZone, date) }));
}
