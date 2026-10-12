import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

// R9.3: the dashboard on a disposable Supabase (loopback in CI, pinned kleeno-test locally) at 1280px and 375px.
// Own uniquely named company with the seeded SIMULATION run (open exceptions), removed afterwards; live payments stay OFF.
// DASH_SHOTS_DIR (outside the repo) optionally receives review screenshots.
let company: TestCompany | undefined;
let runId = "";
const shots = process.env.DASH_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
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

async function checkDashboard(page: Page, width: number) {
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("this run never pays.")).toBeVisible(); // context line
  await expect(page.getByRole("link", { name: /^Open payroll/ })).toHaveAttribute("href", `/runs/${runId}`);

  // Readiness: blocked while exceptions are open, seven steps, blockers by worker code.
  const ready = page.getByRole("region", { name: "Not ready to approve yet" });
  await expect(ready).toBeVisible();
  await expect(ready.getByText(/\d+ blockers?/).first()).toBeVisible();
  const steps = ready.getByRole("list", { name: /progress$/ }).getByRole("listitem");
  await expect(steps).toHaveCount(7);
  for (const [i, name] of ["Policy", "Import", "Reconcile", "HR review", "Payroll approval", "Payment approval", "Settlement"].entries()) await expect(steps.nth(i)).toContainText(name);
  await expect(steps.nth(6)).toContainText("Simulated, never pays");
  await expect(ready.getByRole("heading", { name: "What blocks approval" })).toBeVisible();
  await expect(ready.getByText(/^W\d{3}$/).first()).toBeVisible();
  await expect(ready.getByText("Needs review").first()).toBeVisible();
  await expect(ready.getByRole("link", { name: "Review", exact: true }).first()).toHaveAttribute("href", `/exceptions?run=${runId}`);
  await expect(ready.getByText("Matched automatically")).toBeVisible();

  // Tiles always name Planned vs Settled, and unknown figures never read as zero.
  await expect(page.getByText("Planned", { exact: true })).toBeVisible();
  await expect(page.getByText("Settled", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Paid in 20\d\d/)).toBeVisible();
  await expect(page.getByText("Months paid in")).toBeVisible();
  await expect(page.getByText("None settled yet")).toBeVisible();
  await expect(page.getByText("Workers", { exact: true }).first()).toBeVisible();

  // To-dos, activity, and what must stay reachable.
  await expect(page.getByRole("heading", { name: "My to-dos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View all" })).toHaveAttribute("href", `/audit?run=${runId}`);
  await expect(page.locator("#start-run")).toBeAttached();
  await expect(page.locator("#pay-runs")).toBeAttached();
  await expect(page.getByLabel("Select run")).toBeAttached();

  const body = await page.locator("main, #main").first().innerText();
  expect(body).not.toMatch(/\bNaN\b|\bundefined\b|\[object Object\]/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); // nothing pushes the page sideways
}

test("desktop 1280: readiness, blockers, tiles, to-dos and activity; deep links stay reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await checkDashboard(page, 1280);
  await shot(page, "dashboard-1280");

  await page.goto(`/dashboard?run=${runId}#pay-runs`);
  await expect(page.locator("#pay-runs")).toBeAttached();
  await expect(page.getByLabel("Select run")).toHaveValue(runId);
  await page.getByRole("link", { name: "Open payroll" }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  await page.goto("/dashboard");
  await page.getByRole("region", { name: "Not ready to approve yet" }).getByRole("link", { name: "Review", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/exceptions\\?run=${runId}$`));
});

test("mobile 375: stacked stepper and panels without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await checkDashboard(page, 375);
  await shot(page, "dashboard-375");
  for (const link of await page.getByRole("region", { name: "Not ready to approve yet" }).getByRole("link", { name: "Review", exact: true }).all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
