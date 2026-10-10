// Local synthetic UI acceptance. Real authorization/persistence belongs to the support DB/API checks.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd(), id = "11111111-1111-4111-8111-111111111111";
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const ticket = { id, companyId: "company-1", requesterId: "requester-1", category: "IMPORT", severity: "NORMAL", status: "OPEN", assigneeId: null, revision: 1, createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T12:00:00Z" };
  const thread = { ticket: { ...ticket, subject: "Synthetic import question" }, messages: [{ id: "m1", action: "CREATE", visibility: "CUSTOMER", actorId: "requester-1", revision: 1, createdAt: ticket.createdAt, body: "<script>not executable</script>", evidenceRefs: ["synthetic-correlation"] }, { id: "m2", action: "NOTE", visibility: "INTERNAL", actorId: "staff-1", revision: 2, createdAt: ticket.createdAt, body: "PRIVATE STAFF CANARY", evidenceRefs: [] }] };
  const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{SupportPanel}from'@/components/support-panel';const tickets=${JSON.stringify([ticket])};function Harness(){const[mode,setMode]=useState('requester');return <main className="app-theme p-4"><button onClick={()=>setMode(mode==='staff'?'requester':'staff')}>Switch support mode</button><SupportPanel key={mode} mode={mode} apiBase={mode==='staff'?'/staff/api/support':'/api/support'} initialTickets={tickets} initialTicketId="${id}" currentUserId="requester-1"/></main>}createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") } });
  let failReply = true, revoked = false;
  const commands: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const json = (body: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (!req.url?.includes("/api/support")) { res.statusCode = 404; res.end(); return; }
    if (revoked) { res.statusCode = 403; json({ error: { message: "Access changed" } }); return; }
    if (req.method === "GET") { json(req.url.endsWith(id) ? thread : { tickets: [ticket] }); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const command = JSON.parse(body); commands.push(command);
    if (command.action === "close") { revoked = true; res.statusCode = 403; json({ error: { message: "Access changed" } }); return; }
    if (command.action === "reply" && failReply) { failReply = false; res.statusCode = 409; json({ error: { message: "The request changed. Reload its evidence before trying again." } }); return; }
    ticket.revision++; thread.ticket.revision = ticket.revision;
    json({ id, revision: ticket.revision });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`); await page.addStyleTag({ content: css.css });
    await expect(page.getByRole("heading", { name: "Synthetic import question" })).toBeVisible();
    await expect(page.getByText("PRIVATE STAFF CANARY", { exact: true })).toHaveCount(0);
    await expect(page.getByText("<script>not executable</script>", { exact: true })).toBeVisible();
    await page.getByLabel("Reply message", { exact: true }).fill("Synthetic follow-up draft");
    await page.getByRole("checkbox", { name: "I intend to share this reply and its references with platform support" }).check();
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByLabel("Reply message", { exact: true })).toHaveValue("Synthetic follow-up draft");
    await page.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[0].idempotencyKey).toBe(commands[1].idempotencyKey);
    await page.getByRole("button", { name: "Switch support mode" }).click();
    await expect(page.getByRole("heading", { name: "Internal staff notes" })).toBeVisible();
    await expect(page.getByText("PRIVATE STAFF CANARY", { exact: true })).toBeVisible();
    await page.getByLabel("Internal note", { exact: true }).fill("A synthetic internal note");
    await page.getByRole("button", { name: "Save internal note", exact: true }).click();
    await expect.poll(() => commands[2]?.action).toBe("note");
    await page.getByRole("button", { name: "Switch support mode" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic import question" })).toBeVisible();
    await page.getByRole("button", { name: "Resolve my request", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Access changed");
    await expect(page.getByRole("heading", { name: "Synthetic import question" })).toHaveCount(0);
    await expect(page.getByText("PRIVATE STAFF CANARY", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log("Support browser checks passed: self-only thread display, internal-note separation, inert text, deliberate sharing, draft/retry identity, staff notes, revoked access redaction and 375px.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
