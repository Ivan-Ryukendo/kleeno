import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

// R9.4a: payroll Table, Needs review and Workflow on a disposable Supabase at 1280px and 375px. Own uniquely named company with
// the seeded SIMULATION run (open exceptions), removed afterwards. TAB_SHOTS_DIR (outside the repo) optionally receives screenshots.
let company: TestCompany | undefined;
let runId = "";
const shots = process.env.TAB_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  assertDisposableTarget();
  company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  runId = seedDemo(company.id, company.payroll.id).runId;
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

const noOverflow = async (page: Page, width: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
const cleanText = async (page: Page) => expect(await page.locator("#main").innerText()).not.toMatch(/\bNaN\b|\bundefined\b|\[object Object\]/);

async function frame(page: Page, current: string | null) {
  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Run views" });
  for (const label of ["Table", "Workflow", "Payments", "Activity"]) await expect(tabs.getByText(label)).toBeVisible();
  if (current) await expect(tabs.getByRole("link", { name: current })).toHaveAttribute("aria-current", "page");
  else await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(tabs.getByText("Payments")).toHaveAttribute("aria-disabled", "true"); // SIMULATION never pays
  await expect(page.getByRole("link", { name: /needs review$/i }).first()).toHaveAttribute("href", `/exceptions?run=${runId}`);
  await expect(page.getByRole("button", { name: /^Review and approve/ })).toHaveCount(0); // simulation has no approval
  await expect(page.getByText(/records matched automatically/)).toBeVisible();
}

async function run(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await signIn(page);

  // Table: frame, pay summary table, next step and the sections that used to sit on the page stay reachable.
  await page.goto(`/runs/${runId}`);
  await frame(page, "Table");
  await expect(page.locator("#next-step")).toBeAttached();
  await expect(page.locator("#review-tasks-heading")).toBeAttached();
  await expect(page.locator("#calculation-trace")).toBeAttached();
  await expect(page.getByRole("heading", { name: "Obligations" })).toBeAttached();
  await page.goto(`/runs/${runId}#calculation-trace`);
  await expect(page.getByRole("navigation", { name: "Run views" })).toBeVisible();
  await noOverflow(page, width);
  await cleanText(page);
  await shot(page, `table-${width}`);

  // Period menu keeps the tab.
  await page.locator("summary", { hasText: "choose a pay run" }).click();
  await expect(page.getByRole("list", { name: "Pay runs" }).getByRole("link").first()).toHaveAttribute("href", /^\/runs\//);

  // Workflow: progress, step cards (desktop), step list with disclosures, review-only handoff, nothing executes.
  await page.goto(`/runs/${runId}/workflow`);
  await frame(page, "Workflow");
  await expect(page.getByText(/\d of \d steps done/).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Recorded payroll workflow steps" }).getByRole("listitem")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Review-only handoff" })).toBeVisible();
  await expect(page.locator("#main form, #main button[type=submit]")).toHaveCount(0);
  if (width >= 768) {
    const cards = page.getByRole("list", { name: "Inspect a workflow step" }).getByRole("button");
    await expect(cards).toHaveCount(6);
    await cards.nth(0).click();
    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Pinned policy version").first()).toBeVisible();
  } else {
    await expect(page.getByRole("list", { name: "Inspect a workflow step" })).toBeHidden();
  }
  await page.getByRole("list", { name: "Recorded payroll workflow steps" }).getByText("Exceptions").first().click();
  await expect(page.getByRole("link", { name: "Inspect exceptions" }).first()).toHaveAttribute("href", `/exceptions?run=${runId}`);
  await noOverflow(page, width);
  await cleanText(page);
  await shot(page, `workflow-${width}`);

  // Needs review: back link, open and closed tabs, list with the inspector, decision form, bulk entry, every record table.
  await page.goto(`/exceptions?run=${runId}`);
  await frame(page, null);
  await expect(page.getByRole("link", { name: "Payroll table" })).toHaveAttribute("href", `/runs/${runId}`);
  await expect(page.getByRole("heading", { name: "Needs review", level: 2 })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Review items" });
  await expect(tabs.getByRole("link", { name: /^Open/ })).toHaveAttribute("aria-current", "page");
  const items = page.getByRole("list", { name: "Open items" }).getByRole("link");
  await expect(items.first()).toBeVisible();
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByText("Why this was flagged")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resolve" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save decision" })).toBeDisabled(); // a decision and a note are required
  await expect(page.getByText("Settle several together, by category")).toBeAttached();
  await expect(page.getByRole("heading", { name: "Every imported record" })).toBeVisible();
  if ((await items.count()) > 1) {
    await items.nth(1).click();
    await expect(page).toHaveURL(/item=/);
  }
  await tabs.getByRole("link", { name: /^Resolved and closed/ }).click();
  await expect(page).toHaveURL(/tab=closed/);
  await expect(page.getByText("Nothing has been resolved yet.")).toBeVisible();
  await noOverflow(page, width);
  await cleanText(page);
  await page.goto(`/exceptions?run=${runId}`);
  await shot(page, `review-${width}`);
}

test("desktop 1280: Table, Needs review and Workflow", async ({ page }) => {
  await run(page, 1280);
});

test("mobile 375: Table, Needs review and Workflow without horizontal scroll", async ({ page }) => {
  await run(page, 375);
  for (const link of await page.getByRole("navigation", { name: "Run views" }).getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
