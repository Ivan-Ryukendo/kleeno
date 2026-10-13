import { expect, test } from "@playwright/test";
import { admin, makeCompany } from "../db/helpers";
import { seedDemo } from "./seed";
import { assertDisposableTarget } from "./target";

test("human resolutions lead to checked simulation pay and cannot authorize payment", async ({ page }) => {
  // This suite creates disposable users/evidence. Cloud targets require a separate reviewed rehearsal.
  assertDisposableTarget();
  const company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  const demo = seedDemo(company.id, company.payroll.id);
  expect(seedDemo(company.id, company.payroll.id)).toEqual(demo);

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/runs/${demo.runId}`);
  await expect(page.getByText("EXCEPTIONS PENDING", { exact: true }).first()).toBeVisible();
  const correlations = new Set<string>();
  const workers = new Map((await admin.from("workers").select("id,pseudonym").eq("company_id", company.id)).data!.map(w => [w.id, w.pseudonym]));
  await page.goto(`/exceptions?run=${demo.runId}`);
  for (let round = 0; round < 5; round++) {
    const pending = (await admin.from("exceptions").select("id,category,worker_id").eq("run_id", demo.runId).in("status", ["OPEN", "IN_REVIEW"])).data!;
    if (!pending.length) break;
    for (const e of pending) {
      const action = e.category === "DUPLICATE_TIMESHEET" ? "KEEP_FIRST" : e.category === "LEAVE_WORK_CONFLICT" ? "KEEP_WORK" : e.category === "UNAPPROVED_OVERTIME" ? "APPROVE_HOURS" : "TREAT_AS_PAID_LEAVE";
      await page.goto(`/exceptions?run=${demo.runId}&item=${e.id}`); // R9.4a: the inspector resolves the selected item
      const section = page.getByRole("article");
      const decision = section.getByLabel(`Decision for ${workers.get(e.worker_id)}`, { exact: true });
      await decision.selectOption(action);
      await section.getByLabel(`Note for ${workers.get(e.worker_id)}`, { exact: true }).fill("Synthetic browser rehearsal: human reviewed the evidence");
      const responsePromise = page.waitForResponse(r => r.url().endsWith(`/api/exceptions/${e.id}`) && r.request().method() === "POST");
      await decision.locator("..").getByRole("button", { name: "Save decision", exact: true }).click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const correlation = response.headers()["x-correlation-id"];
      expect(correlation).toMatch(/^[0-9a-f-]{36}$/);
      expect(correlations.has(correlation)).toBe(false);
      correlations.add(correlation);
      await expect(decision).toHaveCount(0, { timeout: 60_000 });
    }
  }
  await expect(page.getByText("Everything is resolved. This run is ready to calculate.")).toBeVisible();
  await page.goto(`/runs/${demo.runId}`);
  await page.getByRole("button", { name: "Calculate pay", exact: true }).click();
  await expect(page.getByText(/Simulation complete\. This run cannot/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Variance:/ })).toBeVisible();
  const denied = await page.request.post(`/api/runs/${demo.runId}/submit`, { headers: { origin: "http://localhost:3000" } });
  expect(denied.status()).toBe(409);
  expect((await admin.from("obligations").select("id").eq("run_id", demo.runId)).data).toEqual([]);
  expect((await admin.from("calculations").select("calculation_hash").eq("run_id", demo.runId)).data).toHaveLength(1);
  expect((await admin.from("ai_executions").select("id").eq("company_id", company.id)).data!.length).toBeGreaterThan(0);

  // R9.4a: the calculated Table tab at both widths: pay renders, nothing overflows, deep links land on their sections.
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(`/runs/${demo.runId}`);
    await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
    expect(await page.locator("#main").innerText()).not.toMatch(/\bNaN\b|\bundefined\b|\[object Object\]/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (process.env.TAB_SHOTS_DIR) await page.screenshot({ path: `${process.env.TAB_SHOTS_DIR}/table-calculated-${width}.png`, fullPage: true });
    for (const hash of ["review-heading", "readiness-heading"]) {
      await page.goto(`/runs/${demo.runId}#${hash}`);
      await expect(page.locator(`#${hash}`)).toBeVisible();
    }
    await page.goto(`/runs/${demo.runId}?baseline=${demo.runId}#review-heading`);
    await expect(page.locator("#review-heading")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
