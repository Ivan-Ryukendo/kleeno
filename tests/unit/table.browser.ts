// Standalone synthetic browser check: npm exec tsx tests/unit/table.browser.ts
// It exercises the real table component with local-only API fixtures; server authorization is covered separately.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd();
  const stylesheet = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const columns = [
    { id: "worker", label: "Worker", type: "text", formula: "Pseudonym from the authorized worker record." },
    { id: "amount", label: "Amount", type: "money", formula: "Approved hours × configured rate." },
  ];
  const rows = [{ worker: "K-001", amount: "125.00" }];
  let lastView: { columns: string[] } | null = null;
  let savedView: { columns: string[] } | null = null;
  const bundle = await build({
    stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {TableView} from '@/components/table-view'; import {LoginForm} from '@/components/login-form';
      const columns=${JSON.stringify(columns)}, rows=${JSON.stringify(rows)};
      const initialView={table:'workers',columns:['worker','amount'],filters:[],sort:null,search:''};
      const initial={columns,rows,total:1,totals:{},truncated:false,rowIds:['worker-1'],cells:{'worker-1':{worker:{formula:'Pseudonym from the authorized worker record.',sources:['workers.pseudonym'],status:'VERIFIED',editable:false},amount:{formula:'Approved hours × configured rate.',sources:['timecard.hours','approved rate'],status:'VERIFIED',editable:false}}}};
      function Harness(){const [table,setTable]=useState('workers');return <div className="app-theme"><LoginForm after="/dashboard"/><button onClick={()=>setTable('lines')}>Show calculated pay</button><TableView table={table} runId={table==='lines'?'run-1':null} columns={columns} initialView={{...initialView,table}} initial={initial} contextKey="synthetic"/></div>}
      createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") },
    plugins: [{ name: "next-link-stub", setup(b) { b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "harness" })); b.onLoad({ filter: /.*/, namespace: "harness" }, () => ({ contents: "import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}", loader: "js", resolveDir: root })); b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation", namespace: "navigation-harness" })); b.onLoad({ filter: /.*/, namespace: "navigation-harness" }, () => ({ contents: "export function useRouter(){return {push(url){window.history.pushState({},'',url)},refresh(){}}}", loader: "js" })); b.onResolve({ filter: /^@\/components\/resource-column-form$/ }, () => ({ path: "resource-form", namespace: "resource-harness" })); b.onLoad({ filter: /.*/, namespace: "resource-harness" }, () => ({ contents: "export function ResourceInputForm(){return null}", loader: "js" })); } }],
  });
  const server = createServer(async (req, res) => {
    const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (req.url === "/api/auth/login" && req.method === "POST") { json({ next: "mfa", factorId: "synthetic-factor" }); return; }
    if (req.url === "/api/auth/mfa/verify" && req.method === "POST") { json({}); return; }
    if (req.url?.startsWith("/api/views/layout?")) { json({ version: 1, view: null }); return; }
    if (req.url === "/api/views/layout" && req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      savedView = JSON.parse(body).view; json({ version: 2 }); return;
    }
    if (req.url === "/api/views/query" && req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body); lastView = parsed.view;
      json({ columns: parsed.view.columns.map((id: string) => columns.find((column) => column.id === id)), rows, total: 1, totals: {}, truncated: false, rowIds: ["worker-1"], cells: { "worker-1": { worker: { formula: columns[0].formula, sources: ["workers.pseudonym"], status: "VERIFIED", editable: false }, amount: { formula: columns[1].formula, sources: ["timecard.hours", "approved rate"], status: "VERIFIED", editable: false } } } }); return;
    }
    if (req.url?.startsWith("/api/views/comments?") && req.method === "GET") { json({ comments: [] }); return; }
    if (req.url === "/api/views/comments" && req.method === "POST") { json({ comment: { id: "comment-1", text: "Synthetic note", authorId: "member-1", createdAt: new Date().toISOString() } }); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: "reduce" });
    const pageErrors: string[] = [], consoleErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await page.addStyleTag({ content: stylesheet.css });
    const email = page.getByLabel("Email", { exact: true });
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
    const authOrder = await page.locator('input[name="email"], input[name="password"], button').evaluateAll((elements) => elements.slice(0, 4).map((element) => element.getAttribute("name") ?? element.textContent?.trim()));
    expect(authOrder).toEqual(["email", "password", "Sign in", "Continue with Google"]);
    await email.fill("synthetic@example.invalid"); await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Code from your authenticator app")).toBeFocused();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await page.getByLabel("Code from your authenticator app").fill("123456");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.waitForTimeout(250);
    if (!await page.getByRole("button", { name: "View Amount details for K-001" }).count()) console.log("Harness page did not render table:", await page.locator("body").innerText(), pageErrors, consoleErrors);
    const cell = page.getByRole("button", { name: "View Amount details for K-001" });
    const disclosure = page.locator("#cell-source-worker-1-amount");
    await expect(disclosure).toHaveCSS("opacity", "0");
    await cell.hover(); await expect(disclosure).toHaveCSS("opacity", "1"); await expect(disclosure).toContainText("Approved hours × configured rate.");
    await page.mouse.move(0, 0); await cell.focus(); await expect(disclosure).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "Comments for Amount, K-001" }).click();
    const commentBox = page.getByLabel("Add a comment"); await expect(commentBox).toBeFocused();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await cell.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Comments" }).click();
    await expect(commentBox).toBeFocused();
    await page.keyboard.press("Escape");
    const workerHeader = page.getByRole("columnheader", { name: "Worker" });
    const amountHeader = page.getByRole("columnheader", { name: "Amount" });
    await amountHeader.dragTo(workerHeader);
    await expect.poll(() => lastView?.columns).toEqual(["amount", "worker"]);
    await page.getByRole("button", { name: "Save my layout" }).click();
    await expect.poll(() => savedView?.columns).toEqual(["amount", "worker"]);
    await page.getByRole("button", { name: "Show calculated pay" }).click();
    await page.getByRole("button", { name: "View Amount details for K-001" }).click();
    const traceLink = page.getByRole("link", { name: "Open calculation trace for K-001" });
    await expect(traceLink).toHaveAttribute("href", "/runs/run-1#trace-worker-1");
    await traceLink.focus(); await expect(traceLink).toBeFocused();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("button", { name: "View Amount details for K-001" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    console.log("Workspace browser checks passed: password-first sign-in/MFA, formula hover/focus, Comments focus, drag ordering/layout requests, keyboard trace link and narrow-screen containment.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
