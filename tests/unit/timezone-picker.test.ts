import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterTimeZones, localTimeParts, moveActive, timeZoneChoices, zoneCity, zoneDisplay } from "@/lib/timezone-display";
import { TimezonePicker } from "@/components/timezone-picker";

const winter = timeZoneChoices("2026-01-15T12:00:00Z");
const summer = timeZoneChoices("2026-07-15T12:00:00Z");
const find = (choices: typeof winter, id: string) => choices.find(c => c.timeZone === id || c.city === id);

describe("timezone labels", () => {
  it("shows city and live offset, including fractional and legacy ICU IDs", () => {
    expect(zoneDisplay("Asia/Dhaka", "2026-10-17T06:00:00Z")).toBe("Dhaka (UTC+6)");
    expect(zoneDisplay("Asia/Kolkata", "2026-10-17T06:00:00Z")).toBe("Kolkata (UTC+5:30)");
    expect(zoneDisplay("Asia/Kathmandu", "2026-10-17T06:00:00Z")).toBe("Kathmandu (UTC+5:45)");
    expect(zoneCity("Asia/Calcutta")).toBe("Kolkata");
    expect(zoneDisplay("UTC")).toBe("UTC");
  });
  it("evaluates DST per instant, never a stored offset", () => {
    expect(find(winter, "America/New_York")?.label).toBe("New York (UTC-5)");
    expect(find(summer, "America/New_York")?.label).toBe("New York (UTC-4)");
    expect(find(summer, "Europe/London")?.label).toBe("London (UTC+1)");
  });
  it("sorts west to east and starts with UTC available", () => {
    expect(winter.some(c => c.timeZone === "UTC")).toBe(true);
    for (let i = 1; i < winter.length; i++) expect(winter[i].minutes).toBeGreaterThanOrEqual(winter[i - 1].minutes);
  });
  it("formats an instant in the chosen zone with a short zone label and refuses civil dates", () => {
    expect(localTimeParts("2026-10-17T06:00:00Z", "Asia/Dhaka")).toEqual({ text: "Oct 17, 2026, 12:00 PM", zone: "Dhaka, UTC+6" });
    expect(localTimeParts("2026-10-17T06:00:00+00:00", "UTC")).toEqual({ text: "Oct 17, 2026, 6:00 AM", zone: "UTC" });
    expect(localTimeParts("2026-10-17", "Asia/Dhaka")).toBeNull();
    expect(localTimeParts("not a date", "Asia/Dhaka")).toBeNull();
  });
});

describe("timezone search", () => {
  it("finds by city, modern alias, region, IANA ID and offset text", () => {
    expect(filterTimeZones(winter, "dhaka")[0].city).toBe("Dhaka");
    expect(filterTimeZones(winter, "Kolkata")[0].label).toBe("Kolkata (UTC+5:30)");
    expect(filterTimeZones(winter, "utc+5:30").map(c => c.city)).toContain("Kolkata");
    expect(filterTimeZones(winter, "GMT+6").map(c => c.city)).toContain("Dhaka");
    expect(filterTimeZones(winter, "new york")[0].city).toBe("New York");
    expect(filterTimeZones(winter, "america indiana").length).toBeGreaterThan(3);
    expect(filterTimeZones(winter, "Asia/Tokyo")[0].city).toBe("Tokyo");
  });
  it("ranks city prefix matches first and returns everything for an empty query", () => {
    expect(filterTimeZones(winter, "lon")[0].city).toBe("London");
    expect(filterTimeZones(winter, "  ")).toHaveLength(winter.length);
    expect(filterTimeZones(winter, "zzzz")).toEqual([]);
  });
});

describe("listbox keyboard", () => {
  it("moves with arrows, Home, End and pages, clamped to the list", () => {
    expect(moveActive("ArrowDown", -1, 5)).toBe(0);
    expect(moveActive("ArrowDown", 4, 5)).toBe(4);
    expect(moveActive("ArrowUp", -1, 5)).toBe(4);
    expect(moveActive("ArrowUp", 0, 5)).toBe(0);
    expect(moveActive("Home", 3, 5)).toBe(0);
    expect(moveActive("End", 0, 5)).toBe(4);
    expect(moveActive("PageDown", 0, 20)).toBe(8);
    expect(moveActive("PageUp", 3, 20)).toBe(0);
    expect(moveActive("a", 0, 5)).toBeNull();
    expect(moveActive("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("TimezonePicker markup", () => {
  const render = (props: Partial<Parameters<typeof TimezonePicker>[0]> = {}) => renderToStaticMarkup(createElement(TimezonePicker, { id: "tz", label: "Time zone", options: winter, value: "Asia/Dhaka", onChange: () => {}, ...props }));
  it("is an accessible collapsed combobox showing the selected city and offset", () => {
    const html = render();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('role="listbox"');
    expect(html).toMatch(/<label for="tz"[^>]*>Time zone<\/label>/);
    expect(html).toContain('value="Dhaka (UTC+6)"');
    expect(html).not.toContain("aria-activedescendant");
  });
  it("offers the clear option and shows it when there is no preference", () => {
    const html = render({ value: null, clearLabel: "Use company default (Dhaka (UTC+6))" });
    expect(html).toContain('value="Use company default (Dhaka (UTC+6))"');
    expect(html).toMatch(/role="option" aria-selected="true"[^>]*>.*Use company default/);
  });
  it("posts the IANA ID through an optional hidden field", () => {
    expect(render({ name: "timezone" })).toContain('type="hidden" name="timezone" value="Asia/Dhaka"');
  });
});

describe("company basics form", () => {
  it("edits the company timezone with the same picker and keeps the existing save flow", async () => {
    const { BasicsForm } = await import("@/components/company-form");
    const profile = { name: "Acme", country: "BD", timezone: "Asia/Dhaka", sizeRange: null, industry: null, payFrequency: null, payDay: null, onboardedAt: null } as unknown as Parameters<typeof BasicsForm>[0]["profile"];
    const html = renderToStaticMarkup(createElement(BasicsForm, { profile, options: { countries: [{ code: "BD", name: "Bangladesh" }], zones: winter } }));
    expect(html).toMatch(/id="timezone"[^>]*role="combobox"|role="combobox"[^>]*id="timezone"/);
    expect(html).toContain('value="Dhaka (UTC+6)"');
    expect(html).not.toContain("Use company default");
    expect(renderToStaticMarkup(createElement(BasicsForm, { profile, options: { countries: [], zones: winter }, disabled: true }))).toMatch(/role="combobox"[^>]*disabled/);
  });
});
