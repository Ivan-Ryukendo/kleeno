// R9.4b browser acceptance on actual page markup and a hydrated ImportWizard; synthetic reads, no database or provider writes.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

const runId = "10000000-0000-4000-8000-000000000001";
const run = { id: runId, mode: "SIMULATION", status: "DRAFT", period_start: "2026-10-01", period_end: "2026-10-31" };
const actor = { companyId: "synthetic-company", userId: "synthetic-reviewer", roles: ["HR_APPROVER"] };
const obligation = { id: "obligation-1", worker: "W001", amount: "120.00", recipient: "0x" + "a".repeat(40), status: "CREATED", held: false, signals: [], txUrl: null, txHash: null, exception: null };
const fixture = {
  run, actor,
  settlement: { company: { live_payments_enabled: false, live_status: "NOT_REQUESTED", is_demo: false, is_sandbox: false, per_payment_ceiling: "1000.00", guard_address: null }, approver: null, balance: null, runs: [{ ...run, mode: "LIVE_TESTNET", status: "OBLIGATIONS_CREATED" }], run: { id: runId, status: "OBLIGATIONS_CREATED", period: "2026-10-01 to 2026-10-31", payrollApprovedByYou: false, total: "200.00", obligations: [obligation, { ...obligation, id: "obligation-2", worker: "W002", amount: "80.00", status: "ON_HOLD", held: true }], batch: { id: "batch-1", status: "PROPOSED", planHash: "a".repeat(64), source: "30000000-0000-4000-8000-000000000001", total: "120.00", count: 1, held: 1, authorizedBy: null }, runSignals: [] } },
  timeline: { items: [{ id: "event-1", event: "import.accepted", entityType: "import_batch", entityId: "batch-1", actor: "synthetic-reviewer", actorType: "human", correlationId: "synthetic-request", at: "2026-10-12T10:00:00Z", refs: { rows: 2 }, href: `/import?run=${runId}` }, { id: "event-2", event: "ai.proposed", entityType: "ai_execution", entityId: "ai-1", actor: "synthetic-model", actorType: "ai", correlationId: null, at: "2026-10-12T09:00:00Z", refs: {}, href: null }], next: null, graphTruncated: false },
};

async function main() {
  const root = process.cwd();
  const font = (await readFile(path.join(root, "src/app/fonts/SofiaSans-Variable.ttf"))).toString("base64");
  // Mirror the existing shell constraints (240px rail, 48px top bar, 16/24px main padding); its navigation is a fixture, not a second implementation.
  const fontCss = `@font-face{font-family:SofiaSans;src:url(data:font/ttf;base64,${font});font-weight:1 1000;font-style:normal;font-display:swap}html{--font-sans:SofiaSans,Arial,sans-serif}.fixture-rail{display:none}.fixture-top{height:48px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 24px;color:var(--muted-foreground);font-size:13px}@media(min-width:768px){.fixture-rail{display:block;position:fixed;inset:0 auto 0 0;width:240px;padding:24px 16px;background:var(--sidebar);border-right:1px solid var(--border)}.fixture-content{margin-left:240px}}`;
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const nextStubs: Record<string, string> = {
    "next/link": `import React from 'react'; export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`,
    "next/server": `export async function connection(){}`,
    "next/navigation": `export function notFound(){throw Error('NOT_FOUND')} export function useRouter(){return {refresh(){},push(url){history.pushState({},'',url)}}}`,
  };
  const serverStubs: Record<string, string> = {
    ...nextStubs,
    "server-only": "",
    "@/components/import-wizard": `import React from 'react'; export function ImportWizard(){return React.createElement('div',{id:'wizard-root'})}`,
    "@/components/payroll/frame-data": `export async function loadFrameData(){const r=globalThis.__payrollFixture.run;return {facts:{workers:2,autoMatched:null,openExceptions:1},runs:[{id:r.id,label:'October 2026',status:r.status}]}}`,
    "@/server/db/client": `export function must(read){if(read.error)throw Error('read failed');return read.data}`,
    "@/server/db/standing": `export async function listStanding(){return []}`,
    "@/server/db/settlement": `export async function settlementView(){return globalThis.__payrollFixture.settlement}`,
    "@/server/db/audit": `export async function auditView(){return globalThis.__payrollFixture.timeline}`,
    "@/server/auth/page-session": `export async function pageSession(){const f=globalThis.__payrollFixture;return {actor:f.actor,client:{from(table){const data=table==='payroll_runs'?[f.run]:table==='workers'?[{pseudonym:'W001'},{pseudonym:'W002'}]:table==='import_batches'?[{id:'batch-1',run_id:f.run.id,import_type:'TIMESHEETS',row_count:2,rejected_count:0,created_at:'2026-10-12T10:00:00Z'}]:[]; const q={select(){return q},eq(){return q},in(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:data[0]??null,error:null}),then(resolve){return resolve({data,error:null})}};return q}}}}`,
  };
  const stubs = (sources: Record<string, string>): Plugin => ({ name: "isolated-reads", setup(b) {
    b.onResolve({ filter: /^(next\/|@\/|server-only$)/ }, args => args.path in sources ? { path: args.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: sources[args.path], loader: "js", resolveDir: root }));
  } });
  const serverBundle = await build({ stdin: { contents: `import {renderToStaticMarkup} from 'react-dom/server'; import Payments from '@/app/(app)/(workspace)/settlement/page'; import Activity from '@/app/(app)/(workspace)/audit/page'; import Import from '@/app/(app)/(workspace)/import/page'; export async function render(kind){const page={payments:Payments,activity:Activity,import:Import}[kind];return renderToStaticMarkup(await page({searchParams:Promise.resolve({run:'${runId}'})}))}`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "cjs", platform: "node", packages: "external", jsx: "automatic", alias: { "@": path.join(root, "src") }, plugins: [stubs(serverStubs)] });
  const loaded = { exports: {} as { render: (kind: string) => Promise<string> } };
  new Function("require", "module", "exports", serverBundle.outputFiles[0].text)(createRequire(path.join(root, "package.json")), loaded, loaded.exports);
  (globalThis as typeof globalThis & { __payrollFixture?: typeof fixture }).__payrollFixture = fixture;
  const pages: Record<string, string> = {};
  for (const kind of ["payments", "activity", "import"]) pages[kind] = await loaded.exports.render(kind);
  const wizard = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ImportWizard} from '@/components/import-wizard'; createRoot(document.getElementById('wizard-root')).render(<ImportWizard runs={[{id:'${runId}',label:'October 2026 · simulation · draft'}]} workerCodes={['W001','W002']} nextCode={3} contextKey='synthetic-company:synthetic-reviewer'/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") }, plugins: [stubs(nextStubs)] });
  const commands: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/wizard.js") { res.setHeader("content-type", "text/javascript"); res.end(wizard.outputFiles[0].text); return; }
    if (req.url === "/api/imports" && req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      commands.push(JSON.parse(body)); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ alreadyImported: false, rows: 2, accepted: 1, newRecords: 1, rejected: [{ row: 3, field: "hours", code: "BAD_VALUE" }] })); return;
    }
    const kind = req.url?.slice(1).split("?")[0] ?? "";
    if (!(kind in pages)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fontCss}</style></head><body><div class="app-theme"><aside class="fixture-rail" aria-label="Synthetic workspace navigation"><p class="mb-6 font-medium">Synthetic company</p><p class="mb-3">Dashboard</p><p class="mb-3 font-medium">Payroll</p><p class="mb-3">All Workers</p><p class="mb-3">Settings</p><p>Help</p></aside><div class="fixture-content"><div class="fixture-top">Synthetic company / Payroll / ${kind}</div><main id="main" class="min-w-0 px-4 pt-5 pb-12 sm:px-6"><div class="mx-auto w-full max-w-6xl">${pages[kind]}</div></main></div></div>${kind === "import" ? '<script type="module" src="/wizard.js"></script>' : ""}</body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const shots = process.env.TAB_SHOTS_DIR;
    if (shots) await mkdir(shots, { recursive: true });
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, reducedMotion: "reduce" });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      const fit = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for (const kind of ["payments", "activity", "import"]) {
        await page.goto(`${base}/${kind}`);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Run views" })).toBeVisible();
        if (kind === "payments") {
          await expect(page.getByRole("region", { name: "Payment totals" })).toBeVisible();
          await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
          await expect(page.getByRole("cell", { name: "DO NOT PAY", exact: false })).toBeVisible();
          await expect(page.getByRole("button", { name: "Sign and pay", exact: true })).toHaveCount(0);
          await expect(page.getByText("A payment approver reviews the plan and signs it.")).toBeVisible();
        }
        if (kind === "activity") {
          await expect(page.getByRole("list", { name: "Recorded activity, newest first" }).getByRole("listitem")).toHaveCount(2);
          await page.getByText("Evidence and trace references").first().focus();
          await page.keyboard.press("Enter");
          await expect(page.getByText("synthetic-request", { exact: true })).toBeVisible();
          await expect(page.getByText("Suggested by AI, not applied", { exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "import · accepted", exact: true })).toHaveAttribute("href", `/import?run=${runId}`);
        }
        if (kind === "import") {
          await expect(page.getByRole("region", { name: "Import progress" })).toBeVisible();
          await expect(page.locator('[aria-current="step"]')).toContainText("Choose file");
          await page.getByLabel("CSV or Excel file", { exact: false }).setInputFiles({ name: "synthetic-timesheets.csv", mimeType: "text/csv", buffer: Buffer.from("worker,date,hours\nW001,2026-10-01,6\nW002,2026-10-02,invalid\n") });
          await expect(page.locator('[aria-current="step"]')).toContainText("Map columns");
          await page.getByRole("button", { name: "Check the file", exact: true }).click();
          await expect(page.locator('[aria-current="step"]')).toContainText("Check");
          await expect(page.getByRole("region", { name: "Local check results" })).toBeVisible();
          await expect(page.getByRole("region", { name: "Valid mapped rows" })).toContainText("W001");
          await expect(page.getByRole("region", { name: "Rejected rows", exact: true })).toContainText("the value is not valid");
          await fit(); if (shots) await page.screenshot({ path: path.join(shots, `r94b-import-check-${width}.png`), fullPage: true });
          await page.getByRole("button", { name: "Send to Kleeno", exact: true }).click();
          await expect(page.getByRole("heading", { name: "Imported", exact: true })).toBeVisible();
          expect(commands.at(-1)?.runId).toBe(runId);
          expect(commands.at(-1)?.items).toEqual([{ row: 2, data: { workerRef: "W001", date: "2026-10-01", hours: "6" } }, { row: 3, data: { workerRef: "W002", date: "2026-10-02", hours: "invalid" } }]);
          await expect(page.locator('[aria-current="step"]')).toContainText("Import");
        }
        await fit();
        if (shots) await page.screenshot({ path: path.join(shots, `r94b-${kind}-${width}.png`), fullPage: true });
      }
      expect(errors).toEqual([]); await page.close();
    }
    console.log("R9.4b browser checks passed at 1280/375: actual page frames, held obligations, read-only payroll role, unavailable wallet, audit evidence keyboard disclosure, hydrated CSV mapping/check/send and exact selected-run payload; no external calls.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
