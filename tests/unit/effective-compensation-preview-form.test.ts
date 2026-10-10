import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { validatedPayPreview, EffectivePayPreview } from "@/components/effective-compensation-preview";
const workerId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222";
const proposal = { runId, effectiveFrom: "2026-01-16", payType: "SALARIED" as const, baseAmount: "3000000000", hourlyRate: "0", expectedRevision: 2, baselineCompensationId: workerId, baselineCompensationVersion: 1, supersedesId: null };
const response = { authority: "PREVIEW_ONLY", runId, workerId, period: { start: "2026-01-01", end: "2026-01-31" }, configVersion: 1, timelineRevision: 2, adjustmentRevision: 0, evidenceFingerprint: "a".repeat(64), proposal: { sourceId: runId, sourceVersion: 3, kind: "PROPOSAL_ONLY", recorded: false }, before: { gross: "2000000000", deductions: "200000000", net: "1800000000", trace: [] }, after: { gross: "2500000000", deductions: "250000000", net: "2250000000", trace: [] }, delta: { gross: "500000000", deductions: "50000000", net: "450000000" } };
it("accepts bound read-only exact money and rejects mismatched tenant object, revision or arithmetic", () => {
  expect(validatedPayPreview(response, workerId, proposal).delta.net).toBe("450000000");
  for (const altered of [{ ...response, workerId: runId }, { ...response, runId: workerId }, { ...response, timelineRevision: 3 }, { ...response, authority: "APPROVED" }, { ...response, delta: { ...response.delta, net: "1" } }, { ...response, after: { ...response.after, net: "2250000001" } }, { ...response, proposal: { ...response.proposal, recorded: true } }]) expect(() => validatedPayPreview(altered, workerId, proposal)).toThrow();
});
it("renders an explicit unavailable preview without inventing a zero result or financial action", () => {
  const html = renderToStaticMarkup(createElement(EffectivePayPreview, { workerId, periods: [], proposal: null }));
  expect(html).toContain("Before and after pay");
  expect(html).toContain("No ready, uncalculated company period");
  expect(html).not.toContain("0.00"); expect(html).not.toContain("Approve"); expect(html).not.toContain("Pay now");
});
