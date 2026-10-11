import { describe, expect, it } from "vitest";
import { formatInstant, resolveTimeZone, timeZoneLabel, timeZoneOptions, TimeZonePreferenceSchema, TimeZoneSchema } from "@/core/timezone";

describe("IANA timezone preferences", () => {
  it("resolves user, company then UTC without accepting corrupt stored zones", () => {
    expect(resolveTimeZone("Asia/Dhaka", "America/New_York")).toEqual({ timeZone: "Asia/Dhaka", source: "user" });
    expect(resolveTimeZone(null, "Europe/London")).toEqual({ timeZone: "Europe/London", source: "company" });
    expect(resolveTimeZone("invalid", "also-invalid")).toEqual({ timeZone: "UTC", source: "utc" });
  });
  it.each(["UTC+6", "+06:00", "Dhaka", "EST", "", "not/a-zone"])("rejects %s instead of persisting an offset or city", zone => {
    expect(TimeZoneSchema.safeParse(zone).success).toBe(false);
  });
  it("allows an explicit preference clear but rejects caller identity fields", () => {
    expect(TimeZonePreferenceSchema.parse({ timezone: null })).toEqual({ timezone: null });
    expect(TimeZonePreferenceSchema.safeParse({ timezone: "UTC", userId: "another-user" }).success).toBe(false);
    expect(TimeZoneSchema.parse("Asia/Dhaka")).toBe("Asia/Dhaka");
  });
});

describe("instant-based display", () => {
  it("labels Dhaka UTC+6 and preserves fractional-hour offsets", () => {
    expect(timeZoneLabel("Asia/Dhaka", "2026-01-01T00:00:00Z")).toBe("UTC+6 Dhaka");
    expect(timeZoneLabel("Asia/Kathmandu", "2026-01-01T00:00:00Z")).toBe("UTC+5:45 Kathmandu");
  });
  it("uses the instant's offset across spring and autumn DST transitions", () => {
    expect(timeZoneLabel("America/New_York", "2026-03-08T06:59:00Z")).toBe("UTC-5 New York");
    expect(timeZoneLabel("America/New_York", "2026-03-08T07:00:00Z")).toBe("UTC-4 New York");
    expect(timeZoneLabel("America/New_York", "2026-11-01T05:59:00Z")).toBe("UTC-4 New York");
    expect(timeZoneLabel("America/New_York", "2026-11-01T06:00:00Z")).toBe("UTC-5 New York");
  });
  it("formats the same UTC instant in the selected zone without mutating it", () => {
    const instant = new Date("2026-01-01T20:15:00Z");
    expect(formatInstant(instant, "Asia/Dhaka", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toContain("02:15");
    expect(instant.toISOString()).toBe("2026-01-01T20:15:00.000Z");
  });
  it.each(["2026-01-01", "2026-01-01T12:00:00", "invalid"])("refuses ambiguous or invalid instant %s", instant => {
    expect(() => formatInstant(instant, "Asia/Dhaka")).toThrow();
  });
  it("lists IANA zones with city and offsets computed for the requested instant", () => {
    const winter = timeZoneOptions("2026-01-01T00:00:00Z");
    const summer = timeZoneOptions("2026-07-01T00:00:00Z");
    expect(winter.find(zone => zone.timeZone === "Asia/Dhaka")).toMatchObject({ city: "Dhaka", label: "UTC+6 Dhaka" });
    expect(winter.find(zone => zone.timeZone === "America/New_York")?.label).toBe("UTC-5 New York");
    expect(summer.find(zone => zone.timeZone === "America/New_York")?.label).toBe("UTC-4 New York");
    expect(winter.some(zone => zone.timeZone === "UTC")).toBe(true);
  });
});
