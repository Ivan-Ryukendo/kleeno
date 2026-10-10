// Synthetic local editor/findings acceptance; no payroll database or provider calls.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd();
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const settings = { revision: 0, version: null, configurationHash: null, rules: [], canConfigure: true };
  const trace = { step: 1, rule: "HOURLY", ruleVersion: 2, source: "<script>inert source</script>", amount: "120.00", inputs: { hours: "6" } };
  const finding = { workerId: "worker-1", component: "HOURLY_PAY", previous: "100.00", current: "120.00", delta: "20.00", percent: { n: "20", d: "1" }, triggeredBy: ["PERCENT"], thresholdId: "policy-1", thresholdVersion: "version-1", currentRunId: "run-1", baselineRunId: "prior-1", currentHash: "a".repeat(64), baselineHash: "b".repeat(64), previousTrace: [{ ...trace, amount: "100.00", ruleVersion: 1 }], currentTrace: [trace] };
  const bundle = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{HistoricalThresholdPanel}from'@/components/historical-threshold-panel';function Harness(){const[frozen,setFrozen]=useState(false);const settings=${JSON.stringify(settings)};return <main className="app-theme p-4"><button onClick={()=>setFrozen(true)}>Use signed review</button><HistoricalThresholdPanel key={String(frozen)} runId="run-1" settings={frozen?{...settings,version:'version-1',revision:1,configurationHash:'settings-hash',canConfigure:false}:settings} components={['HOURLY_PAY']} findings={frozen?{status:'EVALUATED',reason:null,configurationHash:'settings-hash',findings:[${JSON.stringify(finding)}]}:{status:'DISABLED',reason:'No thresholds',configurationHash:null,findings:[]}}/></main>}createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") }, plugins: [{ name: "router", setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export function useRouter(){return {refresh(){}}}", loader: "js" })); } }] });
  const commands: Record<string, unknown>[] = []; let fail = true;
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (req.method !== "POST" || !req.url?.endsWith("/thresholds")) { res.statusCode = 404; res.end(); return; }
    let body = ""; for await (const chunk of req) body += chunk; commands.push(JSON.parse(body)); res.setHeader("content-type", "application/json");
    if (fail) { fail = false; res.statusCode = 409; res.end(JSON.stringify({ error: { message: "Threshold settings changed" } })); } else res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" }); const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" }); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`); await page.addStyleTag({ content: css.css });
    await expect(page.getByText("Alerts disabled: no active thresholds.")).toBeVisible(); await page.getByText("Configure historical alerts", { exact: true }).click(); await page.getByRole("button", { name: "Add threshold", exact: true }).click();
    await page.getByLabel("Rule identifier 1", { exact: true }).fill("policy-1"); await page.getByLabel("Compared component 1", { exact: true }).selectOption("HOURLY_PAY"); await page.getByLabel("Absolute threshold 1 (integer micro-USDC)", { exact: true }).fill("1000000");
    await page.getByLabel("Percentage numerator 1", { exact: true }).fill("5"); await page.getByLabel("Percentage denominator 1", { exact: true }).fill("0"); await page.getByRole("button", { name: "Save historical alerts" }).click(); await expect(page.getByRole("alert")).toBeFocused(); expect(commands).toHaveLength(0);
    await page.getByLabel("Percentage denominator 1", { exact: true }).fill("1"); await page.getByRole("button", { name: "Save historical alerts" }).click(); await expect(page.getByRole("alert")).toContainText("Threshold settings changed"); await expect(page.getByLabel("Absolute threshold 1 (integer micro-USDC)", { exact: true })).toHaveValue("1000000"); await page.getByRole("button", { name: "Save historical alerts" }).click(); await expect.poll(() => commands.length).toBe(2); expect(commands[0].idempotencyKey).toBe(commands[1].idempotencyKey);
    expect(commands[1].rules).toEqual([{ id: "policy-1", component: "HOURLY_PAY", absolute: "1000000", percent: { n: "5", d: "1" } }]);
    await page.getByRole("button", { name: "Remove threshold 1" }).click(); await page.getByRole("button", { name: "Save historical alerts" }).click(); await expect.poll(() => commands.length).toBe(3); expect(commands[2].rules).toEqual([]);
    await page.getByRole("button", { name: "Use signed review" }).click(); await expect(page.getByText("1 threshold findings in this comparison.")).toBeVisible(); await expect(page.getByRole("button", { name: "Save historical alerts" })).toHaveCount(0); await page.getByText("Worker worker-1 · HOURLY_PAY · difference 20.00 USDC", { exact: true }).click(); await expect(page.getByText("Source: <script>inert source</script>", { exact: true })).toHaveCount(2); await expect(page.getByText("Threshold policy-1 · version version-1", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]); console.log("Historical alert browser passed: explicit micro-USDC/ratio editor, validation, draft/retry identity, empty disabled policy, signed freeze, exact inert traces and 375px.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
