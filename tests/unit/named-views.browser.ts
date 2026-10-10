// Synthetic local saved-view/table acceptance; backend checks own tenant and persistence guarantees.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd(), id = "11111111-1111-4111-8111-111111111111", unknown = "22222222-2222-4222-8222-222222222222";
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const columns = [{ id: "code", label: "Code", type: "text" }, { id: "status", label: "Status", type: "enum", values: ["ACTIVE", "LEFT"] }];
  const initialView = { table: "workers", columns: ["code", "status"], filters: [], sort: null, search: "" }, saved = { ...initialView, columns: ["status", "code"], filters: [{ column: "status", op: "is", value: "ACTIVE" }] };
  const summary = { id, scope: "TEAM", ownerId: "owner-1", revision: 1, archived: false, createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T12:00:00Z", name: "<script>literal saved name</script>", available: true, canEdit: true, unavailableReason: null };
  const detail = { ...summary, view: saved, history: [{ id: "event-1", revision: 1, action: "CREATE", actorId: "owner-1", createdAt: summary.createdAt }], hasMoreHistory: false };
  const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{TableView}from'@/components/table-view';const columns=${JSON.stringify(columns)};createRoot(document.getElementById('root')).render(<main className="app-theme p-4"><TableView table="workers" runId={null} columns={columns} initialView={${JSON.stringify(initialView)}} initial={{columns,rows:[{code:'K-001',status:'ACTIVE'}],total:1,totals:{},truncated:false}} contextKey="synthetic-viewer"/></main>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") }, plugins: [{ name: "stubs", setup(b) { b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" })); b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ contents: "import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}", loader: "js", resolveDir: root })); b.onResolve({ filter: /^@\/components\/resource-column-form$/ }, () => ({ path: "resource", namespace: "stub" })); b.onLoad({ filter: /^resource$/, namespace: "stub" }, () => ({ contents: "export function ResourceInputForm(){return null}", loader: "js" })); } }] });
  let fail = true, denied = false, queries = 0, layoutSaves = 0; const commands: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const json = (body: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (req.url?.startsWith("/api/views/layout?") && req.method === "GET") { json({ version: null, view: null }); return; }
    if (req.url?.includes("/named-views") && denied) { res.statusCode = 403; json({ error: { message: "Named view access changed" } }); return; }
    if (req.url === "/api/tables/workers/named-views" && req.method === "GET") { json({ views: [summary, { ...summary, id: unknown, name: "Unknown field view" }], hasMore: false, canCreateTeam: true }); return; }
    if (req.url?.endsWith(`/named-views/${id}`) && req.method === "GET") { json(detail); return; }
    if (req.url?.endsWith(`/named-views/${unknown}`) && req.method === "GET") { json({ ...detail, id: unknown, name: "Unknown field view", archived: false, canEdit: false, view: { ...saved, columns: ["code", "forbiddenMoney"] } }); return; }
    if (req.method !== "POST") { res.statusCode = 404; res.end(); return; }
    let body = ""; for await (const chunk of req) body += chunk; const command = JSON.parse(body);
    if (req.url === "/api/views/query") { queries++; const selected = command.view.columns.map((key: string) => columns.find(column => column.id === key)); json({ columns: selected, availableColumns: columns, rows: [{ code: "K-001", status: "ACTIVE" }], total: 1, totals: {}, truncated: false }); return; }
    if (req.url === "/api/views/layout") { layoutSaves++; json({ version: 1 }); return; }
    if (req.url?.includes("/named-views")) { commands.push(command); if (command.action === "update" && fail) { fail = false; res.statusCode = 409; json({ error: { message: "This view changed. Reload its version and keep your draft." } }); return; } if (command.action === "archive") { detail.archived = true; summary.archived = true; } detail.revision++; summary.revision = detail.revision; json({ id, revision: detail.revision }); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" }); const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" }); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`); await page.addStyleTag({ content: css.css }); await expect(page.getByRole("cell", { name: "K-001", exact: true })).toBeVisible(); await expect.poll(() => queries).toBe(1);
    await page.getByRole("button", { name: "Load named views", exact: true }).click(); await page.getByLabel("Saved view", { exact: true }).selectOption(id); await expect(page.getByText("Owner account: owner-1", { exact: true })).toBeVisible(); expect(await page.getByRole("columnheader").allTextContents()).toEqual(["Code", "Status"]); expect(queries).toBe(1);
    await page.getByRole("button", { name: "Apply selected view", exact: true }).click(); await expect.poll(async () => (await page.getByRole("columnheader").allTextContents())[0]).toBe("Status"); expect(layoutSaves).toBe(0); await expect(page.getByRole("button", { name: "Remove Status filter", exact: true })).toBeVisible();
    await page.getByLabel("Named view name", { exact: true }).fill("Synthetic update draft"); await page.getByRole("button", { name: "Update selected view from current table" }).click(); await expect(page.getByRole("alert")).toBeFocused(); await expect(page.getByLabel("Named view name", { exact: true })).toHaveValue("Synthetic update draft"); await page.getByRole("button", { name: "Update selected view from current table" }).click(); await expect.poll(() => commands.length).toBe(2); expect(commands[0].idempotencyKey).toBe(commands[1].idempotencyKey);
    await page.getByRole("button", { name: "Save current table as a copy" }).click(); await expect.poll(() => commands.length).toBe(3); expect(commands[2].action).toBe("create"); expect(commands[2].view).toEqual(saved);
    await page.getByRole("button", { name: "Archive selected view" }).click(); await expect(page.getByRole("button", { name: "Apply selected view" })).toBeDisabled(); await expect(page.getByRole("cell", { name: "K-001", exact: true })).toBeVisible();
    page.on("dialog", dialog => dialog.accept()); await page.getByLabel("Saved view", { exact: true }).selectOption(unknown); await expect(page.getByLabel("Named view name", { exact: true })).toHaveValue("Unknown field view"); const before = queries; await page.getByRole("button", { name: "Apply selected view" }).click(); await expect(page.getByRole("alert")).toContainText("unknown or unavailable fields"); expect(queries).toBe(before); expect(layoutSaves).toBe(0);
    denied = true; await page.getByRole("button", { name: "Reload named views" }).click(); await expect(page.getByRole("heading", { name: "Table access changed" })).toBeVisible(); await expect(page.getByRole("cell", { name: "K-001", exact: true })).toHaveCount(0); await expect(page.getByLabel("Named view name", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]); console.log("Named view browser passed: explicit apply, preserved defaults, draft/stable retries, copy/update/archive, unknown fields, denied table redaction and 375px.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
