import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { assertReviewAction, buildReviewExport, ReviewCommandSchema, type ReviewView } from "@/core/workflow/review";

const hash = "a".repeat(64);
const view: ReviewView = { revision: 0, calculationId: "11111111-1111-4111-8111-111111111111", calculationHash: hash, signoff: null, export: null, acknowledgement: null };
const lines = [{ workerId: "W2", gross: 9007199254740993n, deductions: 3n, net: 9007199254740990n }, { workerId: "W1", gross: 10n, deductions: 2n, net: 8n }];
const snapshot = { calculationId: view.calculationId!, calculationHash: hash, configVersion: 3, periodStart: "2026-10-01", periodEnd: "2026-10-31", lines };

it("binds signoff to the visible revision and exact immutable calculation", () => {
  expect(() => assertReviewAction(view, { action: "signoff", expectedRevision: 0, calculationId: view.calculationId!, calculationHash: hash }, ["HR_APPROVER"])).not.toThrow();
  for (const patch of [{ expectedRevision: 1 }, { calculationHash: "b".repeat(64) }, { calculationId: "foreign" }]) {
    expect(() => assertReviewAction(view, { action: "signoff", expectedRevision: 0, calculationId: view.calculationId!, calculationHash: hash, ...patch }, ["HR_APPROVER"])).toThrow();
  }
  expect(() => assertReviewAction(view, { action: "signoff", expectedRevision: 0, calculationId: view.calculationId!, calculationHash: hash }, ["PAYMENT_APPROVER"])).toThrow();
});

it("requires separate signoff before export and a manifest before manual acknowledgement", () => {
  const command = { expectedRevision: 0, calculationId: view.calculationId!, calculationHash: hash };
  expect(() => assertReviewAction(view, { ...command, action: "export" }, ["PAYROLL_APPROVER"])).toThrow();
  expect(() => assertReviewAction(view, { ...command, action: "acknowledge" }, ["PAYROLL_APPROVER"])).toThrow();
});

it("reproduces exact CSV bytes, hashes and integer totals independent of input order", () => {
  const first = buildReviewExport(snapshot), second = buildReviewExport({ ...snapshot, lines: [...lines].reverse() });
  expect(first).toEqual(second);
  expect(first.byteHash).toBe(createHash("sha256").update(first.csv, "utf8").digest("hex"));
  expect(first.totals).toEqual({ gross: "9007199254741003", deductions: "5", net: "9007199254740998" });
  expect(first.csv).toContain('"9007199254740993"');
  expect(first.csv).not.toMatch(/wallet|policy|name/i);
});

it("neutralizes spreadsheet formulas and quoted text using the existing CSV writer", () => {
  const out = buildReviewExport({ ...snapshot, lines: [{ workerId: '=HYPERLINK("bad")', gross: 1n, deductions: 0n, net: 1n }] });
  expect(out.csv).toContain('"\'=HYPERLINK(""bad"")"');
});

it("refuses duplicate workers, inconsistent or negative calculated values", () => {
  for (const bad of [[lines[0], lines[0]], [{ ...lines[0], net: 1n }], [{ ...lines[0], gross: -1n, deductions: 0n, net: -1n }]]) expect(() => buildReviewExport({ ...snapshot, lines: bad })).toThrow();
});

it("requires bounded acknowledgement evidence and cannot accept financial or tenant authority fields", () => {
  const base = { action: "acknowledge", idempotencyKey: "22222222-2222-4222-8222-222222222222", expectedRevision: 2, calculationId: view.calculationId, calculationHash: hash, status: "MANUAL_ACCEPTED", reference: "Receipt reference 123" };
  expect(ReviewCommandSchema.safeParse(base).success).toBe(true);
  for (const patch of [{ reference: "" }, { reference: "x".repeat(501) }, { status: "SETTLED" }, { company_id: "foreign" }, { amount: "5" }, { action: "approve" }]) expect(ReviewCommandSchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
