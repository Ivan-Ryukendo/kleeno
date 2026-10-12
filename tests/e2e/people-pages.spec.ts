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
  expect((await admin.from("companies").update({ pay_frequency: "MONTHLY", pay_day: 25, timezone: "UTC", country: "US", size_range: "1_10", industry: "SOFTWARE" }).eq("id", company.id)).error).toBeNull();
});

test.afterAll(async () => {
  if (!company) return;
  await admin.rpc("delete_company", { p_company: company.id });
  for (const u of [company.payroll, company.payment]) await admin.auth.admin.deleteUser(u.id);
});

const ORIGIN = { origin: process.env.PW_ORIGIN ?? "http://localhost:3000" };
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

test("Settings > Company at 1280: details, schedule preview, run mode; nothing without data is shown", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, company!.payroll);
  await page.goto("/settings/company");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Company" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Owner view.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company details" })).toBeVisible();
  await expect(page.getByLabel("Time zone", { exact: true })).toBeVisible(); // RT.2 picker stays
  await expect(page.getByText("Can't be changed")).toBeVisible(); // currency is fixed
  await expect(page.getByRole("heading", { name: "Pay schedule" })).toBeVisible();
  await expect(page.getByText(/Pay date \w{3}, \w{3} \d+/).first()).toBeVisible(); // derived from the saved monthly day 25
  await expect(page.getByText("OFF", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Payments" })).toBeVisible();
  for (const absent of ["Legal name", "Danger zone", "Delete company", "Last changed"]) await expect(page.getByText(absent)).toHaveCount(0); // no backing data or action
  await shot(page, "settings-company-1280");
  const name = page.getByLabel("Display name");
  const renamed = `${await name.inputValue()}-x`;
  await name.fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." }).first()).toBeVisible();
  expect((await admin.from("companies").select("name").eq("id", company!.id).single()).data!.name).toBe(renamed);
  await page.setViewportSize(MOBILE);
  await page.goto("/settings/company");
  await noSidewaysScroll(page, 375);
  await shot(page, "settings-company-375");
});

test("Settings > Team: members table, invite disclosure, pending invite with revoke, role dialog", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, company!.payroll);
  await page.goto("/settings/team");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Team members of this company" });
  await expect(table.getByRole("row")).toHaveCount(3); // header + two members
  await expect(table.getByText("You", { exact: true })).toBeVisible();
  await expect(page.getByText("Last Owner is protected.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What each role can do" })).toBeVisible();
  for (const absent of ["Last active", "Two-step"]) await expect(table.getByRole("columnheader", { name: absent })).toHaveCount(0); // no data: not shown as a column
  await page.getByText("Invite member", { exact: true }).click();
  const email = `invitee-${Date.now()}@example.com`;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Share this link" })).toBeVisible();
  await expect(table.getByText(email, { exact: true })).toBeVisible();
  await expect(table.getByText(/Invite pending/)).toBeVisible();
  await shot(page, "settings-team-1280");
  // Role dialog for the other member; Cancel leaves roles untouched.
  await table.getByRole("button", { name: /^Change roles/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save roles" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await table.getByRole("button", { name: /^Revoke/ }).click();
  await expect(table.getByText(email, { exact: true })).toHaveCount(0);
  await page.setViewportSize(MOBILE);
  await page.goto("/settings/team");
  await noSidewaysScroll(page, 375);
  await shot(page, "settings-team-375");
});

test("Help: labelled static guide with search, tickets list, create and reply keep working", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, company!.payroll);
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.getByText("not a searchable article library")).toBeVisible(); // the guide is static copy and says so
  await expect(page.getByText(/All Kleeno services normal|min read/)).toHaveCount(0); // no status feed or read times exist
  await page.getByRole("searchbox", { name: "Search help guides" }).fill("exception");
  await expect(page.getByRole("link", { name: /Resolve exceptions/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Import the period/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search help guides" }).fill("");
  await page.getByLabel("Subject").fill("Two timesheet rows rejected");
  await page.getByLabel("Category").selectOption("IMPORT");
  await page.getByLabel("Message", { exact: true }).fill("W014 and W027 were rejected on import.");
  await page.getByLabel("I intend to share this message and its references with platform support").check();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("heading", { name: "Two timesheet rows rejected" })).toBeVisible();
  await page.getByLabel("Reply message").fill("Thanks, re-mapped the hours column.");
  await page.getByLabel("I intend to share this reply and its references with platform support").check();
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Thanks, re-mapped the hours column.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Select a request" }).getByRole("button")).toHaveCount(1);
  await shot(page, "help-1280");
  await page.setViewportSize(MOBILE);
  await page.goto("/support");
  await noSidewaysScroll(page, 375);
  await shot(page, "help-375");
});

test("Login at 1280 and 375: password-first card, Google below, show password, code step; no unbacked links", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Kleeno" })).toBeVisible();
  await expect(page.getByText("Use the email your company invited.")).toBeVisible();
  await expect(page.getByText("Google works for existing accounts only.")).toBeVisible();
  await expect(page.getByRole("link", { name: "request access on the home page" })).toHaveAttribute("href", "/#join");
  for (const absent of ["Forgot password", "Trust this browser", "recovery code"]) await expect(page.getByText(absent, { exact: false })).toHaveCount(0); // no backing flow
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("a-long-secret-phrase");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await shot(page, "login-1280", false);
  // The second step renders from the Google-callback URL shape (no session needed to see the card).
  await page.goto("/login?step=mfa&factor=00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Enter your 6-digit code" })).toBeVisible();
  await expect(page.getByLabel("Code from your authenticator app")).toBeFocused();
  await shot(page, "login-mfa-1280", false);
  await page.getByRole("button", { name: "Use a different account" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Kleeno" })).toBeVisible();
  await page.setViewportSize(MOBILE);
  await page.goto("/login");
  await noSidewaysScroll(page, 375);
  await shot(page, "login-375", false);
  // A wrong password still reports through the unchanged endpoint.
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-12345");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("Invite: role card, live password checks, confirm; an unusable link is one calm message", async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, company!.payroll);
  await page.goto("/settings/team");
  await page.getByText("Invite member", { exact: true }).click();
  const email = `joiner-${Date.now()}@example.com`;
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Payroll approver").check();
  await page.getByLabel("Your password, to confirm").fill(company!.payroll.password);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toContain("/invite/");
  const guest = await browser.newContext({ viewport: DESKTOP, baseURL: new URL(page.url()).origin });
  const g = await guest.newPage();
  await g.goto(new URL(link).pathname);
  await expect(g.getByRole("heading", { name: /^Join / })).toBeVisible();
  await expect(g.getByText(/^Roles? offered$/)).toBeVisible();
  await expect(g.getByText("Payroll approver", { exact: true })).toBeVisible();
  await expect(g.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(g.getByLabel("Email", { exact: true })).toHaveJSProperty("readOnly", true);
  const accept = g.getByRole("button", { name: "Accept invite" });
  await expect(accept).toBeDisabled();
  await g.getByLabel(/^Choose a password/).fill("short");
  await expect(g.getByRole("list", { name: "Password requirements" })).toContainText("At least 12 characters (not yet)");
  await g.getByLabel(/^Choose a password/).fill("harbor-lantern-07-xyz");
  await expect(g.getByRole("list", { name: "Password requirements" })).toContainText("At least 12 characters (met)");
  await g.getByLabel("Confirm password", { exact: true }).fill("harbor-lantern-07-abc");
  await expect(g.getByText("Passwords do not match yet.")).toBeVisible();
  await expect(accept).toBeDisabled();
  await g.getByLabel("Confirm password", { exact: true }).fill("harbor-lantern-07-xyz");
  await expect(accept).toBeEnabled();
  await shot(g, "invite-1280", false);
  await g.setViewportSize(MOBILE);
  await noSidewaysScroll(g, 375);
  await shot(g, "invite-375", false);
  await g.goto("/invite/not-a-real-token");
  await expect(g.getByRole("heading", { name: "This invite link can't be used" })).toBeVisible();
  await expect(g.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  await shot(g, "invite-invalid-375", false);
  await guest.close();
  // Withdraw the invite so the company is left as found.
  await page.getByRole("button", { name: /^Revoke/ }).click();
});

test("Onboarding: three numbered steps, then the dashboard", async ({ page }) => {
  const fresh = await makeCompany();
  try {
    await page.setViewportSize(DESKTOP);
    await signIn(page, fresh.payroll);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Secure your account" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Setup progress" })).toContainText("Company basics");
    await expect(page.getByText(/recovery codes/i)).toHaveCount(0);
    await shot(page, "onboarding-1-1280", false);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Company basics" })).toBeVisible();
    await page.getByLabel("Country").selectOption("US");
    await page.getByLabel("Team size").selectOption("1_10");
    await page.getByLabel("Industry").selectOption("SOFTWARE");
    await page.getByLabel("Time zone", { exact: true }).fill("New York");
    await page.getByRole("listbox").getByRole("option").first().click();
    await shot(page, "onboarding-2-1280", false);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Pay schedule" })).toBeVisible();
    await expect(page.getByText("New companies start in SIMULATION, which never pays.")).toBeVisible();
    await page.getByLabel("How often do you pay?").selectOption("MONTHLY");
    await shot(page, "onboarding-3-1280", false);
    await page.setViewportSize(MOBILE);
    await shot(page, "onboarding-3-375", false);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.setViewportSize(MOBILE);
  } finally {
    await admin.rpc("delete_company", { p_company: fresh.id });
    for (const u of [fresh.payroll, fresh.payment]) await admin.auth.admin.deleteUser(u.id);
  }
});
