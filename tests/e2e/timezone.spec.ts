import { expect, test } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { assertDisposableTarget } from "./target";

// RT.2: a user picks a personal time zone on /account with the keyboard, saves it through PATCH /api/profile/timezone,
// sees it after reload, then returns to the company default. Display only; stored timestamps stay UTC.
let company: TestCompany | undefined;

test.afterAll(async () => {
  if (!company) return;
  for (const u of [company.payroll, company.payment]) await admin.schema("growth").from("user_preferences").delete().eq("user_id", u.id);
  await admin.rpc("delete_company", { p_company: company.id });
  for (const u of [company.payroll, company.payment]) await admin.auth.admin.deleteUser(u.id);
});

test("account time zone: keyboard pick, save, reload, back to company default; fits 375px", async ({ page }) => {
  assertDisposableTarget();
  // The RT.1 migration must be applied on the target; the hosted kleeno-test may lag behind CI's disposable database.
  const probe = await admin.schema("growth").from("user_preferences").select("user_id").limit(1);
  test.skip(!!probe.error, "RT.1 user_preferences migration is not applied on this target");

  company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString(), timezone: "America/New_York" }).eq("id", company.id)).error).toBeNull();

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/account");
  const picker = page.getByRole("combobox", { name: "Your time zone" });
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue(/^Use company default \(New York \(UTC-[45]\)\)$/);
  await expect(page.getByText(/Times show in New York \(UTC-[45]\), from the company default/)).toBeVisible();

  // Keyboard only: open, search by city, move with End/Home/arrows, choose with Enter.
  await picker.focus();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.type("dhaka");
  await expect(page.getByRole("option", { name: /Dhaka \(UTC\+6\)/ })).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(picker).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toHaveValue("Dhaka (UTC+6)");

  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. Dates and deadlines now show in Dhaka (UTC+6)." })).toBeVisible();
  const saved = await (await page.request.get("/api/profile/timezone")).json();
  expect(saved).toMatchObject({ preferenceTimezone: "Asia/Dhaka", companyTimezone: "America/New_York", timeZone: "Asia/Dhaka", source: "user" });

  await page.reload();
  await expect(picker).toHaveValue("Dhaka (UTC+6)");
  await expect(page.getByText(/Times show in Dhaka \(UTC\+6\), from your preference/)).toBeVisible();

  // Search by offset text and Escape closes without changing the value.
  await picker.click();
  await page.keyboard.type("utc+5:30");
  await expect(page.getByRole("option", { name: /Kolkata \(UTC\+5:30\)/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveValue("Dhaka (UTC+6)");

  // Clear the preference: back to the company default.
  await picker.click();
  await page.getByRole("option", { name: /Use company default/ }).click();
  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByRole("status").filter({ hasText: /now show in New York/ })).toBeVisible();
  expect(await (await page.request.get("/api/profile/timezone")).json()).toMatchObject({ preferenceTimezone: null, source: "company" });

  // 375px: no horizontal overflow and the open list fits the viewport.
  await page.setViewportSize({ width: 375, height: 740 });
  await picker.click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
