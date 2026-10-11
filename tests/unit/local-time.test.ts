import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const store = vi.hoisted(() => ({ preference: vi.fn(), company: vi.fn() }));
vi.mock("@/server/db/profile-timezone", () => ({ loadProfileTimezone: store.preference }));
vi.mock("@/server/db/company", () => ({ getCompany: store.company }));
import { LocalTime } from "@/components/local-time";
import { zoneDisplaySafe } from "@/lib/timezone-display";
import { viewerTimeZone } from "@/server/display-timezone";

const who = { userId: "u", companyId: "c" };
beforeEach(() => { store.preference.mockReset(); store.company.mockReset(); });

it("shows a stored UTC instant in the viewer zone with a short zone label and keeps the UTC value machine-readable", () => {
  const html = renderToStaticMarkup(createElement(LocalTime, { at: "2026-10-17T06:00:00Z", timeZone: "Asia/Dhaka" }));
  expect(html).toContain('dateTime="2026-10-17T06:00:00Z"');
  expect(html).toContain(">Oct 17, 2026, 12:00 PM (Dhaka, UTC+6)</time>");
  expect(html).toContain('title="2026-10-17T06:00:00Z (stored as UTC)"');
  expect(renderToStaticMarkup(createElement(LocalTime, { at: "2026-03-08T12:00:00Z", timeZone: "America/New_York" }))).toContain("Mar 8, 2026, 8:00 AM (New York, UTC-4)");
});

it("renders non-instants unchanged instead of guessing a zone", () => {
  expect(renderToStaticMarkup(createElement(LocalTime, { at: "2026-10-17", timeZone: "Asia/Dhaka" }))).toBe("<time>2026-10-17</time>");
  expect(zoneDisplaySafe("Not/AZone", "2026-10-17T06:00:00Z")).toBe("Not/AZone");
  expect(zoneDisplaySafe("Asia/Kolkata", "2026-10-17T06:00:00Z")).toBe("Kolkata (UTC+5:30)");
});

it("resolves the viewer zone from the preference, then the company, then UTC, without blocking the page", async () => {
  store.preference.mockResolvedValue({ timeZone: "Asia/Dhaka" });
  await expect(viewerTimeZone(who, "America/New_York")).resolves.toBe("Asia/Dhaka");
  expect(store.preference).toHaveBeenCalledWith(who);
  store.preference.mockRejectedValue(new Error("profile timezone unavailable")); // e.g. migration not applied yet
  await expect(viewerTimeZone(who, "America/New_York")).resolves.toBe("America/New_York");
  store.company.mockResolvedValue({ profile: { timezone: "Europe/London" } });
  await expect(viewerTimeZone(who)).resolves.toBe("Europe/London");
  await expect(viewerTimeZone(who, null)).resolves.toBe("UTC");
  store.company.mockRejectedValue(new Error("down"));
  await expect(viewerTimeZone(who)).resolves.toBe("UTC");
});
