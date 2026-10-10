// Local synthetic experience checks; repository authorization/persistence has separate checks.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd(), run = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222";
  const css = await postcss([tailwind()]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{ReviewTaskPanel}from'@/components/review-task-panel';createRoot(document.getElementById('root')).render(<main className="app-theme p-4"><ReviewTaskPanel runId="${run}"/></main>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") } });
  const commands: Record<string, unknown>[] = []; let fail = true, denied = false;
  let task: Record<string, unknown> | null = null;
  const server = createServer(async (req, res) => {
    const json = (body: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    if (!req.url?.endsWith("/tasks")) { res.statusCode = 404; res.end(); return; }
    if (denied) { res.statusCode = 403; json({ error: { message: "Task access changed" } }); return; }
    if (req.method === "GET") { json({ tasks: task ? [task] : [], assignees: [{ id: actor, roles: ["HR_APPROVER"] }], sources: [{ kind: "MISSING_EVIDENCE", importType: "TIMESHEETS" }] }); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const command = JSON.parse(body); commands.push(command);
    if (fail) { fail = false; res.statusCode = 409; json({ error: { message: "Review evidence changed; reload before updating." } }); return; }
    if (command.status === "RESOLVED") { denied = true; res.statusCode = 403; json({ error: { message: "Task access changed" } }); return; }
    task = { ...command, id: "event-1", revision: 1, actorId: actor, at: "2026-10-07T12:00:00Z", assigneeAvailable: true, history: [{ ...command, id: "event-1", revision: 1, actorId: actor, at: "2026-10-07T12:00:00Z" }] }; json({ taskId: command.taskId });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.TABLE_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" }); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`); await page.addStyleTag({ content: css.css });
    await expect(page.getByText("No review tasks recorded.")).toBeVisible();
    await page.getByLabel("Task source", { exact: true }).selectOption("0"); await page.getByLabel("Assignee", { exact: true }).selectOption(actor);
    await page.getByLabel("Due date and time with UTC offset", { exact: true }).fill("2026-10-08T17:00:00"); await page.getByLabel("Next action", { exact: true }).fill("<script>literal task evidence</script>");
    await page.getByRole("button", { name: "Create review task" }).click(); await expect(page.getByRole("alert")).toBeFocused(); expect(commands).toHaveLength(0);
    await page.getByLabel("Due date and time with UTC offset", { exact: true }).fill("2026-10-08T17:00:00+06:00");
    await page.getByRole("button", { name: "Create review task" }).click(); await expect(page.getByRole("alert")).toContainText("Review evidence changed"); await expect(page.getByLabel("Next action", { exact: true })).toHaveValue("<script>literal task evidence</script>");
    await page.getByRole("button", { name: "Create review task" }).click(); await expect.poll(() => commands.length).toBe(2); expect(commands[0].taskId).toBe(commands[1].taskId); expect(commands[0].idempotencyKey).toBe(commands[1].idempotencyKey);
    await expect(page.getByLabel("Task", { exact: true }).locator("option")).toHaveCount(2); await page.getByLabel("Task", { exact: true }).selectOption(String(commands[1].taskId));
    await expect(page.getByText("Missing timesheets · revision 1", { exact: true })).toBeVisible(); await page.getByText("Recorded task history", { exact: true }).click(); await expect(page.getByRole("article").getByText("<script>literal task evidence</script>", { exact: true })).toBeVisible();
    await page.getByLabel("Task status", { exact: true }).selectOption("RESOLVED"); await page.getByRole("button", { name: "Save task update" }).click();
    await expect(page.getByRole("alert")).toContainText("Task access changed"); await expect(page.getByLabel("Next action", { exact: true })).toHaveCount(0); await expect(page.getByText("<script>literal task evidence</script>", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
    console.log("Review task browser passed: explicit timezone, draft/retry/task identity, inert history, source separation, denied redaction and 375px.");
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
