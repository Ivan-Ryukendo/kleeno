import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin, makeCompany, type TestCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

// R2.6: authenticated SIMULATION journey on a disposable Supabase (loopback in CI, pinned kleeno-test locally).
// Uses its own uniquely named company and removes it afterwards; live payments stay OFF throughout.
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
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("SIMULATION", { exact: true }).first()).toBeVisible(); // top-bar mode badge: live payments are off (the guard row moved to Payments)
  await expect(page.getByText("this run never pays.")).toBeVisible();
  await expect(page.getByText("Simulation ends with validated calculation and variance review. It creates no payment obligations.")).toBeVisible();

  await page.goto("/workers");
  await expect(page.getByRole("heading", { name: "All Workers", exact: true })).toBeVisible();
  await expect(page.getByText("W001").first()).toBeVisible();

  await page.goto(`/runs/${demo.runId}`);
  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  await expect(page.getByText("EXCEPTIONS PENDING", { exact: true }).first()).toBeVisible();
  await page.goto(`/exceptions?run=${demo.runId}`);
  await expect(page.getByText("Duplicate timesheet lines").first()).toBeVisible();
  await page.goto(`/settlement?run=${demo.runId}`);
  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments unavailable for this run", exact: true })).toBeVisible();
  await expect(page.getByText("Only eligible live testnet runs appear in the payment view. This run is not in the current payment list. Simulation never pays.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to selected run", exact: true })).toHaveAttribute("href", `/runs/${demo.runId}`);
  await page.goto("/settlement");
  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live payments" }).first()).toBeVisible(); // the live-payments row and guard moved here from the dashboard
  await expect(page.getByText("OFF", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Guard contract")).toBeVisible();

  // No live path: a LIVE_TESTNET run is refused, submission for approval is refused, and no batch can be opened or executed.
  const live = await page.request.post("/api/runs", { headers: ORIGIN, data: { mode: "LIVE_TESTNET", periodStart: "2031-01-01", periodEnd: "2031-01-14" } });
  expect(live.status()).toBe(409); // WorkflowError LIVE_PAYMENTS_DISABLED: the kill switch is off for this company
  expect((await live.json()).error.code).toBe("LIVE_PAYMENTS_DISABLED");
  expect((await page.request.post(`/api/runs/${demo.runId}/submit`, { headers: ORIGIN })).status()).toBe(409);
  // This user is Owner + payroll approver, not a payment approver: the role check refuses before any batch is looked up.
  for (const step of ["open", "sign", "execute"]) {
    const res = await page.request.post(`/api/batches/${randomUUID()}/${step}`, { headers: ORIGIN, data: step === "sign" ? { password: company.payroll.password } : {} });
    expect(res.status(), step).toBe(403);
    expect((await res.json()).error.code, step).toBe("FORBIDDEN");
  }
  expect((await admin.from("payroll_runs").select("id").eq("company_id", company.id).eq("mode", "LIVE_TESTNET")).data).toEqual([]);
  expect((await admin.from("obligations").select("id").eq("run_id", demo.runId)).data).toEqual([]);
  expect((await admin.from("companies").select("live_payments_enabled").eq("id", company.id).single()).data?.live_payments_enabled).toBe(false);
});
