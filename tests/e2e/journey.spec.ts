import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { assertDisposableTarget } from "./target";

// R2.6: authenticated SIMULATION journey on a disposable Supabase (loopback in CI, pinned kleeno-test locally).
// Uses its own uniquely named company and removes it afterwards; live payments stay OFF throughout.
// The seed runs as its own tsx process (same entry as npm run seed:demo): Playwright's loader cannot resolve @/ aliases in lazily imported server modules on newer Node 22.
function seedDemo(companyId: string, userId: string) {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", "scripts/seed-demo.ts"], { env: { ...process.env, DEMO_COMPANY_ID: companyId, DEMO_OWNER_ID: userId }, encoding: "utf8", timeout: 600_000 });
  return JSON.parse(out.trim().split(String.fromCharCode(10)).pop()!.trim()) as { runId: string; mode: string };
}
const ORIGIN = { origin: "http://localhost:3000" };
let company: TestCompany | undefined;

test.afterAll(async () => {
  if (!company) return;
  await admin.rpc("delete_company", { p_company: company.id });
  for (const u of [company.payroll, company.payment]) await admin.auth.admin.deleteUser(u.id);
});

test("owner signs in, walks a seeded SIMULATION run, and no live payment path opens", async ({ page }) => {
  assertDisposableTarget();
  company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  const demo = seedDemo(company.id, company.payroll.id);
  expect(demo.mode).toBe("SIMULATION");
  expect(seedDemo(company.id, company.payroll.id).runId).toBe(demo.runId); // idempotent

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByText("Live payments", { exact: true })).toBeVisible();
  await expect(page.getByText("OFF", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Simulation ends with validated calculation and variance review. It creates no payment obligations.")).toBeVisible();

  await page.goto("/workers");
  await expect(page.getByRole("heading", { name: "Workers", exact: true })).toBeVisible();
  await expect(page.getByText("W001").first()).toBeVisible();

  await page.goto(`/runs/${demo.runId}`);
  await expect(page.getByRole("heading", { name: /^Pay run / })).toBeVisible();
  await expect(page.getByText("EXCEPTIONS PENDING", { exact: true }).first()).toBeVisible();
  await page.goto(`/exceptions?run=${demo.runId}`);
  await expect(page.getByText("Duplicate timesheet lines").first()).toBeVisible();
  await page.goto(`/settlement?run=${demo.runId}`);
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();

  // No live path: a LIVE_TESTNET run is refused, submission for approval is refused, and no batch can be opened or executed.
  const live = await page.request.post("/api/runs", { headers: ORIGIN, data: { mode: "LIVE_TESTNET", periodStart: "2031-01-01", periodEnd: "2031-01-14" } });
  expect(live.ok()).toBe(false);
  expect((await page.request.post(`/api/runs/${demo.runId}/submit`, { headers: ORIGIN })).status()).toBe(409);
  for (const step of ["open", "sign", "execute"]) {
    expect((await page.request.post(`/api/batches/${randomUUID()}/${step}`, { headers: ORIGIN, data: {} })).ok()).toBe(false);
  }
  expect((await admin.from("payroll_runs").select("id").eq("company_id", company.id).eq("mode", "LIVE_TESTNET")).data).toEqual([]);
  expect((await admin.from("obligations").select("id").eq("run_id", demo.runId)).data).toEqual([]);
  expect((await admin.from("companies").select("live_payments_enabled").eq("id", company.id).single()).data?.live_payments_enabled).toBe(false);
});
