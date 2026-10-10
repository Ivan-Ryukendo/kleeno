// Styled synthetic disclosure checks only; no authenticated DB/provider evidence is claimed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { RunWorkflowView, type RunWorkflowData } from "../../src/components/run-workflow-view";

async function main() {
  const cssPath = path.join(process.cwd(), "src/app/globals.css");
  const css = await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath });
  const id = "10000000-0000-4000-8000-000000000001";
  const data: RunWorkflowData = {
    company: { id, name: "Synthetic workspace" }, run: { id, mode: "SIMULATION", status: "CALCULATION_VALIDATED", periodStart: "2026-10-01", periodEnd: "2026-10-31", configVersion: 2 },
    steps: ["Policy", "Import", "Exceptions", "Calculation", "Approval", "Settlement"].map((label, index) => ({ label, state: index === 2 ? "blocked" : index >= 4 ? "unavailable" : "done", detail: index === 2 ? "1 open" : index >= 4 ? "Simulation cannot pay" : "" })),
    financial: true, canPayroll: true, canPay: true, facts: { workers: null, autoMatched: null, openExceptions: 1, settled: null, obligations: null }, calculationHash: "a".repeat(64),
    review: { readiness: { ready: false, expected: 1, received: 0, cutoff: null, blockers: ["Company cutoff requires configuration"], items: [{ id: "TIMESHEETS", label: "Timesheet import", status: "MISSING", ref: null, reason: "Not received" }] }, view: { revision: 3, calculationId: id, calculationHash: "a".repeat(64), signoff: { id, actor: id, at: "2026-10-07T12:00:00Z" }, export: { id, formatVersion: 1, byteHash: "b".repeat(64), totals: { gross: "100", deductions: "0", net: "100" }, at: "2026-10-07T12:00:00Z" }, acknowledgement: { status: "UNKNOWN", reference: "<script>owner-supplied synthetic reference</script>", at: "2026-10-07T12:00:00Z" } } },
  };
  const browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    const show = async (value: RunWorkflowData) => {
      await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="app-theme p-4"><h1>Run workflow</h1>${renderToStaticMarkup(createElement(RunWorkflowView, { data: value }))}</main></body></html>`);
      await page.addStyleTag({ content: css.css });
    };
    await show(data);
    await expect(page.getByRole("list", { name: "Recorded payroll workflow steps" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Recorded review and handoff steps" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
    await expect(page.getByText("Manual outcome unknown; still needs review", { exact: true })).toBeVisible();
    const firstSummary = page.locator("summary").first();
    await firstSummary.focus(); await expect(firstSummary).toBeFocused();
    await firstSummary.press("Enter");
    await expect(page.locator("details").first()).toHaveAttribute("open", "");
    await expect(page.getByText("Pinned policy version:", { exact: false })).toBeVisible();
    expect(await firstSummary.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const readiness = page.locator("summary").filter({ hasText: "Review readiness" });
    await readiness.click();
    await expect(page.getByText("Company cutoff requires configuration", { exact: true })).toBeVisible();
    const handoff = page.locator("summary").filter({ hasText: "Manual handoff acknowledgement" });
    await handoff.focus(); await handoff.press("Enter");
    await expect(page.getByText("<script>owner-supplied synthetic reference</script>", { exact: true })).toBeVisible();
    await expect(page.locator("script")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 812, height: 375 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    await show({ ...data, financial: false, canPayroll: false, canPay: false, calculationHash: null, review: null });
    await expect(page.getByText("Your role cannot inspect private review evidence.", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Recorded review and handoff steps" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download recorded CSV" })).toHaveCount(0);
    await show({ ...data, review: null });
    await expect(page.getByRole("status")).toContainText("Review evidence unavailable");
    console.log("Workflow browser checks passed: native keyboard/touch disclosure, safe reference text, separate simulation/handoff, denied/missing evidence, 375px/landscape containment and reduced motion.");
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
