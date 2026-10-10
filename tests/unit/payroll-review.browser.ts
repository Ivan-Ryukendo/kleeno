// Synthetic component acceptance: no database, providers or real payroll evidence.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd();
  const csv = "worker,net\nW001,120.00\n", byteHash = createHash("sha256").update(csv).digest("hex");
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const review = { revision: 0, calculationId: "calc-1", calculationHash: "a".repeat(64), signoff: null, export: null, acknowledgement: null };
  const data = { readiness: { ready: false, received: 0, expected: 1, cutoff: null, blockers: ["Company cutoff is not configured"], items: [{ id: "TIMESHEETS", label: "Timesheets", status: "MISSING", ref: null, reason: "Data required" }] }, comparison: null, baselines: [{ id: "prior-1", label: "2026-09-01 to 2026-09-30" }], selectedBaselineId: null, review, canReview: true, canConfigure: true, settings: null };
  const totals = { previous: "100.00", current: "120.00", delta: "20.00" };
  const evidence = { step: 1, component: "HOURLY_PAY", rule: "HOURLY", ruleVersion: 2, source: "approved hours", amount: "120.00", inputs: { hours: "6", hourlyRate: "20" } };
  const ready = { ...data, settings: { revision: 1, cutoffAt: "2026-10-12T17:00:00+06:00", timeZone: "Asia/Dhaka", requiredTypes: ["TIMESHEETS"], freshAfter: null }, readiness: { ...data.readiness, ready: true, received: 1, cutoff: { at: "2026-10-12T17:00:00+06:00", timeZone: "Asia/Dhaka" }, blockers: [], items: [{ ...data.readiness.items[0], status: "RECEIVED", ref: "evidence-1", reason: null }] }, selectedBaselineId: "prior-1", comparison: { status: "COMPARED", reason: null, baseline: { id: "prior-1", period: { start: "2026-09-01", end: "2026-09-30" }, calculationHash: "b".repeat(64), configVersion: 1 }, totals: { gross: totals, deductions: { previous: "0.00", current: "0.00", delta: "0.00" }, net: totals }, workers: [{ workerId: "worker-1", worker: "W001", change: "Changed", currentTraceId: "line-1", net: totals, components: [{ component: "HOURLY_PAY", ...totals, previousTrace: [{ ...evidence, amount: "100.00", ruleVersion: 1, inputs: { hours: "5", hourlyRate: "20" } }], currentTrace: [evidence] }] }] } };
  const bundle = await build({ stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {PayrollReviewPanel} from '@/components/payroll-review-panel'; const missing=${JSON.stringify(data)}, ready=${JSON.stringify(ready)}; function Harness(){const [data,setData]=useState(missing);return <main className="app-theme p-4"><button onClick={()=>setData(ready)}>Use ready evidence</button><PayrollReviewPanel key={data.readiness.ready?'ready':'missing'} runId="run-1" data={data}/></main>} createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") }, plugins: [{ name: "router", setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export function useRouter(){return {push(url){window.history.pushState({},'',url)},refresh(){}}}", loader: "js" })); } }] });
  let fail = true, deny = false;
  const commands: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (req.method !== "POST") { res.statusCode = 404; res.end(); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const command = JSON.parse(body); commands.push(command);
    res.setHeader("content-type", "application/json");
    if (deny) { res.statusCode = 403; res.end(JSON.stringify({ error: { message: "Review access changed" } })); return; }
    if (req.url?.endsWith("/readiness")) { res.end("{}"); return; }
    if (fail) { fail = false; res.statusCode = 409; res.end(JSON.stringify({ error: { message: "The review changed; reload and try again" } })); return; }
    const view = { ...review, revision: commands.length, signoff: { id: "signoff-1", actor: "actor-1", at: "2026-10-07T12:00:00Z" }, export: command.action === "signoff" ? null : { id: "export-1", formatVersion: 1, byteHash, totals: { gross: "120000000", deductions: "0", net: "120000000" }, at: "2026-10-07T12:00:00Z" }, acknowledgement: command.action === "acknowledge" ? { status: command.status, reference: command.reference, at: "2026-10-07T12:00:00Z" } : null };
    res.end(JSON.stringify({ view, ...(command.action === "export" ? { download: { filename: "kleeno-review.csv", csv, byteHash } } : {}) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`); await page.addStyleTag({ content: css.css });
    await expect(page.getByText("Company cutoff is not configured", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign off this review", exact: true })).toBeDisabled();
    await page.getByLabel("Cutoff (date/time with UTC offset)").fill("2026-10-12T17:00:00+06:00");
    await page.getByLabel("Company timezone").fill("Asia/Dhaka");
    await page.getByRole("checkbox", { name: "Timesheets", exact: true }).check();
    await page.getByRole("button", { name: "Save readiness settings" }).click();
    await expect.poll(() => commands[0]?.requiredTypes).toEqual(["TIMESHEETS"]);
    await page.getByLabel("Comparison baseline").selectOption("prior-1");
    await expect(page).toHaveURL(/baseline=prior-1/);
    await page.getByRole("button", { name: "Use ready evidence" }).click();
    await expect(page.getByText("W001", { exact: true })).toBeVisible();
    await page.getByText("W001", { exact: true }).click();
    await expect(page.getByText("HOURLY PAY", { exact: true })).toBeVisible();
    await page.getByText("Sources and rules for HOURLY PAY", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Current component evidence", exact: true }).locator("..").getByText("Source: approved hours", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect the current calculation trace" })).toHaveAttribute("href", "#trace-line-1");
    await page.getByRole("button", { name: "Sign off this review", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("The review changed");
    await expect(page.getByRole("alert")).toBeFocused();
    await page.getByRole("button", { name: "Sign off this review", exact: true }).click();
    expect(commands[1].idempotencyKey).toBe(commands[2].idempotencyKey);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download reviewed CSV" }).click();
    expect((await download).suggestedFilename()).toBe("kleeno-review.csv");
    await page.getByLabel("Manual handoff outcome").selectOption("UNKNOWN");
    await page.getByLabel("Evidence reference").fill("Synthetic delivery ticket 123");
    await page.getByRole("button", { name: "Record manual outcome" }).click();
    await expect(page.getByText("Unknown — handoff remains open", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel("Evidence reference").focus(); await expect(page.getByLabel("Evidence reference")).toBeFocused();
    deny = true;
    await page.getByLabel("Evidence reference").fill("Synthetic denied evidence");
    await page.getByRole("button", { name: "Record manual outcome", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review access changed" })).toBeVisible();
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByText("W001", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What changed" })).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log("Reviewer browser checks passed: blocked readiness/settings, explicit baseline/component comparison, stale error focus, retry identity, CSV download/manual unknown, keyboard and 375px.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
