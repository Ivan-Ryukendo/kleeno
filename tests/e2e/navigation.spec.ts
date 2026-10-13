import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

// R9.2: the new shell on a disposable Supabase (loopback in CI, pinned kleeno-test locally). Walks the sidebar, run tabs,
// settings sections, account chip and search palette at 1280px and 375px. Own uniquely named company, removed afterwards;
// live payments stay OFF. NAV_SHOTS_DIR (outside the repo) optionally receives review screenshots.
let company: TestCompany | undefined;
let runId = "";
const shots = process.env.NAV_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  assertDisposableTarget();
  company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  const demo = seedDemo(company.id, company.payroll.id);
  expect(demo.mode).toBe("SIMULATION");
  runId = demo.runId;
});

test.afterAll(async () => {
  if (!company) return;
  await admin.rpc("delete_company", { p_company: company.id });
  for (const u of [company.payroll, company.payment]) await admin.auth.admin.deleteUser(u.id);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company!.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company!.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]').filter({ visible: true });
const crumb = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });

async function search(page: Page, query: string, option: string | RegExp) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill(query);
  await dialog.getByRole("option", { name: option }).first().click();
  await expect(dialog).toBeHidden();
}

test("desktop 1280: sidebar, run tabs, settings sections, account chip and search reach every destination", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  const nav = sidebar(page);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(crumb(page)).toContainText("Dashboard");
  for (const label of ["Dashboard", "All Workers", "Settings", "Help"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  const payroll = nav.getByRole("link", { name: /^Payroll/ });
  await expect(payroll).toHaveAccessibleName(/^Payroll, \d+ open exceptions?$/); // seeded run has open exceptions
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#pay-runs")).toBeAttached();
  await expect(page.locator("#start-run")).toBeAttached(); // payroll role: start a run stays on the dashboard
  await shot(page, "dashboard-1280");

  // Payroll opens the current run; run tabs sit beside the title.
  await payroll.click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  await expect(payroll).toHaveAttribute("aria-current", "page");
  await expect(crumb(page)).toContainText("Payroll");
  const tabs = page.getByRole("navigation", { name: "Run views" });
  await expect(tabs.getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByText("Payments")).toHaveAttribute("aria-disabled", "true"); // SIMULATION never pays
  await expect(tabs.locator('a[href^="/settlement"]')).toHaveCount(0);
  await shot(page, "run-1280");
  await tabs.getByRole("link", { name: "Workflow" }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/workflow$`));
  await expect(page.getByRole("heading", { name: "Payroll workflow" })).toBeVisible();
  await expect(crumb(page)).toContainText("Workflow");
  await page.getByRole("navigation", { name: "Run views" }).getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/audit\\?run=${runId}$`));
  await expect(crumb(page)).toContainText("Activity");
  await page.goto(`/runs/${runId}`);
  await page.getByRole("link", { name: /needs review$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/exceptions\\?run=${runId}$`));
  await expect(page.getByText("Duplicate timesheet lines").first()).toBeVisible();

  // Deep links keep working.
  await page.goto(`/dashboard?run=${runId}#pay-runs`);
  await expect(page.locator("#pay-runs")).toBeAttached();
  await page.goto(`/runs/${runId}#calculation-trace`);
  await expect(page.getByRole("navigation", { name: "Run views" })).toBeVisible();

  // All Workers, Help.
  await nav.getByRole("link", { name: "All Workers", exact: true }).click();
  await expect(page).toHaveURL(/\/workers$/);
  await expect(page.getByRole("heading", { name: "All Workers", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Help", exact: true }).click();
  await expect(page).toHaveURL(/\/support$/);

  // Settings frame: one section list across company, team, pay policy, billing and account.
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/company$/);
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Company" })).toHaveAttribute("aria-current", "page");
  await shot(page, "settings-1280");
  for (const [label, url] of [["Team", /\/settings\/team$/], ["Pay policy", /\/configuration$/], ["Billing", /\/settings\/billing$/], ["Account", /\/account$/]] as const) {
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
  }

  // Search palette: screens that left the sidebar, and worker codes open the worker's history.
  await search(page, "Import", "Import");
  await expect(page).toHaveURL(/\/import$/);
  await search(page, "Needs review", "Needs review");
  await expect(page).toHaveURL(/\/exceptions$/);
  await search(page, "Activity", "Activity");
  await expect(page).toHaveURL(/\/audit$/);
  await search(page, "Start a pay run", "Start a pay run");
  await expect(page).toHaveURL(/\/dashboard#start-run$/);
  await search(page, "W001", "W001");
  await expect(page).toHaveURL(/\/workers\?worker=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "W001 · History" })).toBeVisible(); // the worker history panel opens from the deep link
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "W001 · History" })).toBeHidden();

  // Account chip: Account and Sign out.
  await nav.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await nav.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("mobile 375: drawer, run tabs with 44px targets and scrolling settings sections", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await shot(page, "dashboard-375");

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("link", { name: /^Payroll/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Account menu for / })).toBeVisible();
  await shot(page, "drawer-375");
  await drawer.getByRole("link", { name: /^Payroll/ }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  await expect(page.getByRole("dialog")).toBeHidden(); // the drawer closes on navigation

  const tabs = page.getByRole("navigation", { name: "Run views" });
  await expect(tabs).toBeVisible();
  for (const link of await tabs.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375); // nothing pushes the page sideways
  await shot(page, "run-375");

  await page.goto("/settings/company");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Company" })).toHaveAttribute("aria-current", "page");
  for (const link of await sections.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await sections.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/settings/company");
  await shot(page, "settings-375");
});
