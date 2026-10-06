import { expect, test } from "@playwright/test";
import { seedSimulationDemo } from "../../scripts/seed-demo";
import { admin, makeCompany } from "../db/helpers";

test("human resolutions lead to checked simulation pay and cannot authorize payment", async ({ page }) => {
  const url = new URL(process.env.SUPABASE_URL ?? "http://invalid");
  // This suite creates disposable users/evidence. Cloud targets require a separate reviewed rehearsal.
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("e2e requires isolated local Supabase");
  const company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true }).eq("id", company.id)).error).toBeNull();
  const demo = await seedSimulationDemo(company.id, company.payroll.id);
  expect(await seedSimulationDemo(company.id, company.payroll.id)).toEqual(demo);

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/runs/${demo.runId}`);
  await expect(page.getByText("EXCEPTIONS PENDING", { exact: true }).first()).toBeVisible();
  const correlations = new Set<string>();
  const workers = new Map((await admin.from("workers").select("id,pseudonym").eq("company_id", company.id)).data!.map(w => [w.id, w.pseudonym]));
  const categoryLabel: Record<string, string> = { DUPLICATE_TIMESHEET: "Duplicate timesheet lines", LEAVE_WORK_CONFLICT: "Leave and work on the same day", UNAPPROVED_OVERTIME: "Hours above the limit without approval", UNEXPLAINED_MISSING_HOURS: "Unexplained missing hours" };
  await page.goto(`/exceptions?run=${demo.runId}`);
  for (let round = 0; round < 5; round++) {
    const pending = (await admin.from("exceptions").select("id,category,worker_id").eq("run_id", demo.runId).in("status", ["OPEN", "IN_REVIEW"])).data!;
    if (!pending.length) break;
    for (const e of pending) {
      const action = e.category === "DUPLICATE_TIMESHEET" ? "KEEP_FIRST" : e.category === "LEAVE_WORK_CONFLICT" ? "KEEP_WORK" : e.category === "UNAPPROVED_OVERTIME" ? "APPROVE_HOURS" : "TREAT_AS_PAID_LEAVE";
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name: new RegExp(categoryLabel[e.category]) }) });
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
      await expect(decision).toHaveCount(0);
    }
  }
  await expect(page.getByText("Everything is resolved. This run is ready to calculate.")).toBeVisible();
  await page.goto(`/runs/${demo.runId}`);
  await page.getByRole("button", { name: "Calculate pay", exact: true }).click();
  await expect(page.getByText(/Simulation complete\. This run cannot/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Variance:/ })).toBeVisible();
  const denied = await page.request.post(`/api/runs/${demo.runId}/submit`, { headers: { origin: "http://127.0.0.1:3000" } });
  expect(denied.status()).toBe(409);
  expect((await admin.from("obligations").select("id").eq("run_id", demo.runId)).data).toEqual([]);
  expect((await admin.from("calculations").select("calculation_hash").eq("run_id", demo.runId)).data).toHaveLength(1);
  expect((await admin.from("ai_executions").select("id").eq("company_id", company.id)).data!.length).toBeGreaterThan(0);
});
