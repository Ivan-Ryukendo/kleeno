import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADDR, admin, makeCompany, type TestCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

// R9.5: All Workers, Settings company/team, Help and the auth pages against their mockups, on a disposable Supabase (loopback in CI,
// pinned kleeno-test locally). Own uniquely named company, removed afterwards; live payments stay OFF. PEOPLE_SHOTS_DIR (outside
// the repo) optionally receives review screenshots at 1280 and 375.
let company: TestCompany | undefined;
let workerIds: string[] = [];
const shots = process.env.PEOPLE_SHOTS_DIR;
const shot = async (page: Page, name: string, fullPage = true) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage });
};
const DESKTOP = { width: 1280, height: 860 };
const MOBILE = { width: 375, height: 812 };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  assertDisposableTarget();
  company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  expect(seedDemo(company.id, company.payroll.id).mode).toBe("SIMULATION");
  // One confirmed external wallet and one change still waiting for a second approver (state the page must surface, never invent).
  const workers = (await admin.from("workers").select("id,pseudonym").eq("company_id", company.id).order("pseudonym")).data!;
  expect(workers.length).toBeGreaterThan(2);
  expect((await admin.from("workers").update({ wallet_address: ADDR(1), wallet_confirmed_address: ADDR(1), wallet_source: "CIRCLE" }).eq("id", workers[0].id)).error).toBeNull(); // a wallet Kleeno created is confirmed at once
  expect((await admin.from("workers").update({ wallet_address: ADDR(2), wallet_source: "EXTERNAL", wallet_set_by: company.payroll.id }).eq("id", workers[1].id)).error).toBeNull();
  workerIds = workers.map((w) => w.id);
});

test.afterAll(async () => {
  if (!company) return;
  await admin.rpc("delete_company", { p_company: company.id });
  for (const u of [company.payroll, company.payment]) await admin.auth.admin.deleteUser(u.id);
});

const ORIGIN = { origin: "http://localhost:3000" };
const LABELS = [["Chief Executive", "Management", "EMPLOYEE", "2025-01-01"], ["Front-end developer", "Engineering", "CONTRACTOR", "2026-02-01"], ["Product designer", "Design", "CONTRACTOR", "2025-11-01"], ["HR lead", "People", "EMPLOYEE", "2025-09-01"]] as const;
// Worker details (job, department, type, start date) go through the existing guarded metadata endpoint, as HR would.
async function describeWorkers(page: Page) {
  for (const [i, [jobTitle, department, workerType, employmentStart]] of LABELS.entries()) {
    const r = await page.request.post(`/api/workers/${workerIds[i]}/metadata`, { headers: ORIGIN, data: { metadata: { jobTitle, department, workerType, tags: [], employmentStart, employmentEnd: null } } });
    expect(r.ok()).toBe(true);
  }
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
const noSidewaysScroll = async (page: Page, width: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

test("All Workers at 1280: filters with counts, columns, pending wallet notice, no pay amounts", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, company!.payroll);
  await describeWorkers(page);
  await page.goto("/workers");
  await expect(page.getByRole("heading", { name: "All Workers", exact: true })).toBeVisible();
  const directory = page.getByRole("region", { name: "Worker directory" });
  await expect(directory.getByRole("link", { name: "W001 history" })).toBeVisible(); // names stay locked: codes only
  await expect(directory.getByText("Name locked").first()).toBeVisible();
  for (const column of ["Worker", "Job title", "Department", "Pay type", "Start date", "Payout wallet", "Status"]) await expect(directory.getByText(column, { exact: true }).first()).toBeAttached();
  await expect(directory.getByText("Verified")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "waiting for a second approver" })).toContainText("W002");
  await expect(page.getByText("Pay amounts are in Payroll, not here")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\d+\.\d{2} USDC/); // no pay amounts in the directory
  // Filters carry counts; Needs attention narrows to the pending wallet; Left is a calm empty state.
  const filters = page.getByRole("group", { name: "Filter workers" });
  await expect(filters.getByText("All", { exact: false }).first()).toContainText(/\d+/);
  await filters.getByText("Needs attention").click();
  await expect(directory.getByRole("listitem")).toHaveCount(1);
  await filters.getByText("Left", { exact: false }).first().click();
  await expect(directory.getByText(/No one has left/)).toBeVisible();
  await filters.getByText("All", { exact: false }).first().click();
  await page.getByRole("searchbox", { name: "Search workers" }).fill("W003");
  await expect(directory.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search workers" }).fill("");
  await shot(page, "workers-1280");
  // Existing actions stay reachable: Manage opens the guarded worker actions; the history link keeps its deep link.
  await directory.getByRole("button", { name: /^Manage W001/ }).click();
  await expect(page.getByRole("button", { name: "Schedule pay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as left" })).toBeVisible();
  await directory.getByRole("link", { name: "W001 history" }).click();
  await expect(page).toHaveURL(/\/workers\?worker=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "W001 · History" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Add worker opens its form from the header button.
  await page.getByRole("link", { name: "Add worker" }).click();
  await expect(page.getByLabel("Worker code")).toBeVisible();
});

test("All Workers at 375: compact list, cards layout, nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await signIn(page, company!.payroll);
  await page.goto("/workers");
  await expect(page.getByRole("heading", { name: "All Workers", exact: true })).toBeVisible();
  await noSidewaysScroll(page, 375);
  await shot(page, "workers-375");
  await page.getByText("Cards", { exact: true }).click();
  await noSidewaysScroll(page, 375);
  await shot(page, "workers-cards-375");
});
