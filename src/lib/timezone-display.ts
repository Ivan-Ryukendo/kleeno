// Display-only timezone helpers for the UI (RT.2). Built on the RT.1 pure helpers; stored timestamps stay UTC.
import { formatInstant, timeZoneLabel, timeZoneOptions } from "@/core/timezone";

// ICU keeps some legacy canonical IDs (Node returns Asia/Calcutta for Asia/Kolkata). Show and search the current city name.
const MODERN_CITY: Record<string, string> = {
  Calcutta: "Kolkata", Katmandu: "Kathmandu", Saigon: "Ho Chi Minh City", Rangoon: "Yangon", Kiev: "Kyiv", Godthab: "Nuuk",
  Asmera: "Asmara", Dacca: "Dhaka", Thimbu: "Thimphu", "Ujung Pandang": "Makassar", "Ulan Bator": "Ulaanbaatar",
  Chungking: "Chongqing", Faeroe: "Faroe", Uzhgorod: "Uzhhorod", Zaporozhye: "Zaporizhzhia",
};

export interface TimeZoneChoice { timeZone: string; city: string; region: string; offset: string; minutes: number; label: string; search: string }

/** City name of an IANA ID ("Asia/Calcutta" -> "Kolkata"). */
export function zoneCity(timeZone: string): string {
  if (timeZone === "UTC") return "UTC";
  const raw = timeZone.split("/").at(-1)!.replaceAll("_", " ");
  return MODERN_CITY[raw] ?? raw;
}

/** Offset text for this instant: "UTC+6", "UTC+5:30", "UTC-3", "UTC". Uses the RT.1 label so DST is instant-specific. */
export function zoneOffset(timeZone: string, instant: string | number | Date = new Date()): string {
  return timeZoneLabel(timeZone, instant).split(" ")[0];
}

/** "Dhaka (UTC+6)"; UTC stays "UTC". */
export function zoneDisplay(timeZone: string, instant: string | number | Date = new Date()): string {
  return timeZone === "UTC" ? "UTC" : `${zoneCity(timeZone)} (${zoneOffset(timeZone, instant)})`;
}

function offsetMinutes(offset: string): number {
  const m = offset.match(/^UTC([+-])(\d+)(?::(\d{2}))?$/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

const norm = (text: string) => text.toLowerCase().replaceAll("_", " ").replaceAll("gmt", "utc").replace(/\s+/g, " ").trim();

/** Picker options with live offsets, sorted west to east then by city. Build on the server: Intl data differs between Node and browsers. */
export function timeZoneChoices(instant: string | number | Date = new Date()): TimeZoneChoice[] {
  return timeZoneOptions(instant instanceof Date ? instant.toISOString() : instant)
    .map(({ timeZone, city: rawCity, label }) => {
      const offset = label.split(" ")[0];
      const city = zoneCity(timeZone);
      const region = timeZone === "UTC" ? "Coordinated Universal Time" : timeZone.split("/").slice(0, -1).join(" / ").replaceAll("_", " ");
      return { timeZone, city, region, offset, minutes: offsetMinutes(offset), label: timeZone === "UTC" ? "UTC" : `${city} (${offset})`, search: norm(`${city} ${rawCity} ${region} ${timeZone} ${offset}${offset === "UTC" ? " utc+0 +0" : ""}`) };
    })
    .sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));
}

/** Every query word must appear in city, region, IANA ID or offset ("dhaka", "asia", "+5:30", "gmt-3"). City prefix matches rank first. */
export function filterTimeZones(choices: readonly TimeZoneChoice[], query: string): TimeZoneChoice[] {
  const q = norm(query);
  if (!q) return [...choices];
  const words = q.split(" ");
  const hits = choices.filter(c => words.every(w => c.search.includes(w)));
  const rank = (c: TimeZoneChoice) => (c.city.toLowerCase().startsWith(q) ? 0 : c.city.toLowerCase().includes(q) ? 1 : 2);
  return hits.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c);
}

/** Active option after a key press in an open listbox of `count` options; null means "key not handled". */
export function moveActive(key: string, current: number, count: number, page = 8): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : Math.min(current + 1, count - 1);
    case "ArrowUp": return current < 0 ? count - 1 : Math.max(current - 1, 0);
    case "Home": return 0;
    case "End": return count - 1;
    case "PageDown": return Math.min(Math.max(current, 0) + page, count - 1);
    case "PageUp": return Math.max(current - page, 0);
    default: return null;
  }
}

/** "Oct 17, 2026, 12:00 PM" in the zone plus "Dhaka, UTC+6"; null when the value is not a UTC/offset instant. */
export function localTimeParts(instant: string, timeZone: string): { text: string; zone: string } | null {
  try {
    const text = formatInstant(instant, timeZone, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return { text, zone: timeZone === "UTC" ? "UTC" : `${zoneCity(timeZone)}, ${zoneOffset(timeZone, instant)}` };
  } catch {
    return null;
  }
}
