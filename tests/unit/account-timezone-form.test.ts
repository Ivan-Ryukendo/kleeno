import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AccountTimezoneForm, choiceLabel, fetchTimezone, saveTimezone } from "@/components/account-timezone-form";
import { timeZoneChoices } from "@/lib/timezone-display";

const options = timeZoneChoices("2026-10-17T06:00:00Z");
const view = { preferenceTimezone: "Asia/Dhaka", companyTimezone: "America/New_York", timeZone: "Asia/Dhaka", source: "user", label: "UTC+6 Dhaka" };
afterEach(() => vi.unstubAllGlobals());

it("reads the caller's own preference without caching and without sending identity", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(view), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchTimezone()).resolves.toEqual({ ok: true, view });
  expect(fetch).toHaveBeenCalledWith("/api/profile/timezone", { cache: "no-store" });
});

it("PATCHes only {timezone}, including null for the company default", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ...view, preferenceTimezone: null, timeZone: "America/New_York", source: "company" }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const saved = await saveTimezone(null);
  expect(saved.ok && saved.view.source).toBe("company");
  expect(fetch).toHaveBeenCalledWith("/api/profile/timezone", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: null }) });
  await saveTimezone("Asia/Dhaka");
  expect(fetch).toHaveBeenLastCalledWith("/api/profile/timezone", expect.objectContaining({ body: JSON.stringify({ timezone: "Asia/Dhaka" }) }));
});

it("explains MFA denial, keeps support codes and treats malformed success as a failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Forbidden" } }), { status: 403 })));
  await expect(fetchTimezone()).resolves.toMatchObject({ ok: false, denied: true, message: expect.stringContaining("two-step") });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Choose an IANA timezone" }, correlationId: "c-1" }), { status: 400 })));
  await expect(saveTimezone("Mars/Base")).resolves.toEqual({ ok: false, denied: false, message: "Choose an IANA timezone (support code c-1)" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  await expect(fetchTimezone()).resolves.toMatchObject({ ok: false, message: "Your time zone could not be loaded." });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  await expect(saveTimezone("Asia/Dhaka")).resolves.toMatchObject({ ok: false, message: "Could not reach the server" });
});

it("labels zones from the server-built options, including ICU aliases", () => {
  expect(choiceLabel(options, "Asia/Dhaka")).toBe("Dhaka (UTC+6)");
  expect(choiceLabel(options, "Asia/Kolkata")).toBe("Kolkata (UTC+5:30)");
  expect(choiceLabel(options, null)).toBe("UTC");
});

it("renders a disabled loading picker until the preference arrives (no guessed zone)", () => {
  const html = renderToStaticMarkup(createElement(AccountTimezoneForm, { options }));
  expect(html).toContain("Your time zone");
  expect(html).toContain("Loading your time zone");
  expect(html).toMatch(/role="combobox"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
});
