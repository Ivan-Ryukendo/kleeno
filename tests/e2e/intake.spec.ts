import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { codeFor, emptyNameKey, sealNameKey } from "../../src/core/ingest/name-key";
import { POLICY_TEXT } from "../fixtures/ai/policy";
import { admin, makeCompany } from "../db/helpers";
import { seedIntake } from "./seed";
import { assertDisposableTarget } from "./target";

// Synthetic cached proposal, not a live-model evaluation. The real app still performs upload,
// validation, approval, imports and calculation; offline.mjs rejects external provider requests.
test("reviewed policy and browser CSV/XLSX intake produce traceable simulation pay", async ({ page }) => {
  assertDisposableTarget();
  const company = await makeCompany();
  expect((await admin.from("companies").update({ is_demo: true, onboarded_at: new Date().toISOString() }).eq("id", company.id)).error).toBeNull();
  const seeded = seedIntake(company.id, company.payroll.id, company.payroll.roles);
  expect(seeded.status).toBe("ACCEPTED");
  const workerId = seeded.workerId;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(company.payroll.email);
  await page.getByLabel("Password", { exact: true }).fill(company.payroll.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/configuration");
  await page.getByLabel("Browse files or drop them here").setInputFiles({ name: "private-policy-filename.txt", mimeType: "text/plain", buffer: Buffer.from(POLICY_TEXT) });
  await expect(page.getByLabel("Editable extracted text, document 1")).toHaveValue(POLICY_TEXT);
  await expect(page.getByRole("button", { name: "Ask AI to propose rules" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I checked this document/ }).check();
  await page.getByRole("button", { name: "Use reviewed policy text" }).click();
  const proposalResponse = page.waitForResponse(r => r.url().endsWith("/api/configs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Ask AI to propose rules" }).click();
  const proposal = await proposalResponse;
  expect(proposal.ok()).toBe(true);
  expect(proposal.request().postData()).not.toContain("private-policy-filename");
  const proposed = await proposal.json();
  expect(proposed.cacheHit).toBe(true);
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: `Version ${proposed.config.version}`, exact: true }) });
  await expect(card.getByText("Suggested by AI, not applied until you approve")).toBeVisible();
  expect((await admin.from("payroll_configurations").select("status").eq("id", proposed.config.id).single()).data?.status).toBe("HUMAN_REVIEW");
  await card.getByRole("button", { name: "Approve this version" }).click();
  await card.getByRole("button", { name: "Make this the active version" }).click();
  await expect(card.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  expect((await admin.from("payroll_configurations").select("status,clauses_enc").eq("id", proposed.config.id).single()).data?.status).toBe("ACTIVE");

  await page.goto("/dashboard");
  await page.getByLabel("Period start", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Period end", { exact: true }).fill("2026-10-01");
  const runResponse = page.waitForResponse(r => r.url().endsWith("/api/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Start a run", exact: true }).click();
  const run = await runResponse;
  expect(run.ok()).toBe(true);
  const { id: runId } = await run.json();
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto("/import");
  await page.getByLabel("Payroll run", { exact: true }).selectOption(runId);
  await page.getByLabel("CSV or Excel file").setInputFiles({ name: "private-hours.csv", mimeType: "text/csv", buffer: Buffer.from("Worker,Date,Hours,Private note\nW001,2026-10-01,8,CSV-PRIVATE-CANARY\n") });
  await page.getByRole("button", { name: "Check the file", exact: true }).click();
  const csvResponse = page.waitForResponse(r => r.url().endsWith("/api/imports") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Send to Kleeno", exact: true }).click();
  const csv = await csvResponse;
  expect(csv.ok()).toBe(true);
  expect(csv.request().postData()).not.toMatch(/CSV-PRIVATE-CANARY|private-hours/);
  expect((await csv.json()).newRecords).toBe(1);
  await expect(page.getByRole("heading", { name: "Imported", exact: true })).toBeVisible();

  await page.getByLabel("What is in the file").selectOption("ACTUAL_PAID");
  const name = "Synthetic Browser Name Canary", passphrase = "synthetic correct horse battery";
  const key = emptyNameKey();
  expect(codeFor(key, name)).toBe("W001");
  await page.getByLabel("CSV or Excel file").setInputFiles({ name: "private-paid.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: actualPaidWorkbook(name) });
  await expect(page.getByLabel("Passphrase (at least 12 characters)")).toBeVisible();
  await page.getByLabel("Existing name key file (if you have one)").setInputFiles({ name: "private-key.json", mimeType: "application/json", buffer: Buffer.from(await sealNameKey(key, passphrase)) });
  await expect(page.getByRole("button", { name: "Check the file", exact: true })).toBeEnabled();
  await page.getByLabel("Passphrase (at least 12 characters)").fill(passphrase);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Check the file", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("kleeno-name-key.json");
  const localChecks = page.getByRole("region", { name: "Local check results", exact: true });
  for (const [label, count] of [["Rows in file", "2"], ["Valid format", "1"], ["Rejected locally", "1"]]) {
    await expect(localChecks.getByText(label, { exact: true }).locator("..").getByText(count, { exact: true })).toBeVisible();
  }
  const rejectedRow = page.getByRole("region", { name: "Rejected rows", exact: true }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "3", exact: true }) });
  await expect(rejectedRow.getByRole("cell", { name: "currency", exact: true })).toBeVisible();
  await expect(rejectedRow.getByRole("cell", { name: "not USD (only USD is supported)", exact: true })).toBeVisible();
  const xlsxResponse = page.waitForResponse(r => r.url().endsWith("/api/imports") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Send to Kleeno", exact: true }).click();
  const xlsx = await xlsxResponse;
  expect(xlsx.ok()).toBe(true);
  expect(xlsx.request().postData()).not.toMatch(/Synthetic Browser Name Canary|private-paid|private-key|synthetic correct horse|EXECUTE_EVIL|XLSX-PRIVATE-CANARY/);
  expect(xlsx.request().postDataJSON().items[0].data).toEqual({ workerRef: "W001", amount: "144", currency: "USD" });
  const imported = await xlsx.json();
  expect(imported.newRecords).toBe(1);
  expect(imported.rejected).toEqual([{ row: 3, field: "currency", code: "CURRENCY" }]);
  expect((await admin.from("timesheets").select("id").eq("run_id", runId).eq("worker_id", workerId)).data).toHaveLength(1);
  const paid = (await admin.from("actual_payments").select("*").eq("run_id", runId)).data;
  expect(paid).toHaveLength(1);
  expect(JSON.stringify(paid)).not.toContain(name);

  await page.goto(`/exceptions?run=${runId}`);
  await page.getByRole("button", { name: "Run the checks", exact: true }).click();
  await expect(page.getByText("Everything is resolved. This run is ready to calculate.")).toBeVisible();
  await page.goto(`/runs/${runId}`);
  await page.getByRole("button", { name: "Calculate pay", exact: true }).click();
  await expect(page.getByText(/Simulation complete\. This run cannot/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Variance:/ })).toBeVisible();
  await page.getByRole("button", { name: "View Net (USDC) details for W001", exact: true }).click();
  await page.getByRole("link", { name: "Open calculation trace for W001", exact: true }).click();
  await expect(page).toHaveURL(/#trace-/);
  await expect(page.getByLabel("Calculation trace for W001", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Calculation trace for W001", { exact: true })).toContainText("net 144.00 USDC");
  const denied = await page.request.post(`/api/runs/${runId}/submit`, { headers: { origin: "http://localhost:3000" } });
  expect(denied.status()).toBe(409);
  expect((await admin.from("obligations").select("id").eq("run_id", runId)).data).toEqual([]);

  await page.goto("/workers");
  const table = page.locator("section").filter({ has: page.getByRole("heading", { name: "Table view", exact: true }) });
  await table.getByRole("button", { name: "Comments for Code, W001", exact: true }).click();
  await expect(page.getByLabel("Add a comment", { exact: true })).toBeFocused();
  const comment = "Synthetic reviewed source question";
  await page.getByLabel("Add a comment", { exact: true }).fill(comment);
  await page.getByRole("button", { name: "Add shared comment", exact: true }).click();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await table.locator("summary").filter({ hasText: "Columns" }).click();
  await table.getByRole("button", { name: "Move Code right", exact: true }).click();
  const layoutResponse = page.waitForResponse(r => r.url().endsWith("/api/views/layout") && r.request().method() === "POST");
  await table.getByRole("button", { name: "Save my layout", exact: true }).click();
  expect((await layoutResponse).ok()).toBe(true);
  await page.reload();
  await expect(table.getByRole("columnheader").first()).toHaveText("Pay type");
  await table.getByRole("button", { name: "Comments for Code, W001", exact: true }).click();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();
  const stored = await admin.from("cell_comments").select("text_enc").eq("company_id", company.id).eq("row_id", workerId);
  expect(stored.error).toBeNull();
  expect(stored.data).toHaveLength(1);
  expect(JSON.stringify(stored.data)).not.toContain(comment);
  expect(pageErrors).toEqual([]);
});

function actualPaidWorkbook(name: string): Buffer {
  const text = (cell: string, value: string) => `<c r="${cell}" t="inlineStr"><is><t>${value}</t></is></c>`;
  return Buffer.from(zipSync(Object.fromEntries(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Paid" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${text("A1", "Name")}${text("B1", "Amount")}${text("C1", "Currency")}${text("D1", "Private note")}</row><row r="2">${text("A2", name)}<c r="B2"><f>EXECUTE_EVIL()</f><v>144</v></c>${text("C2", "USD")}${text("D2", "XLSX-PRIVATE-CANARY")}</row><row r="3">${text("A3", name)}<c r="B3"><v>1</v></c>${text("C3", "EUR")}</row></sheetData></worksheet>`,
  }).map(([filename, value]) => [filename, strToU8(value)]))));
}
