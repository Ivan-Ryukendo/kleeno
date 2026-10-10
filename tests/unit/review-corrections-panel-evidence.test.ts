import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ index: 0, view: null as unknown, replacementId: "" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const index = state.index++; return [index === 0 ? state.view : index === 1 ? false : index === 5 ? state.replacementId : initial, vi.fn()]; } }));
import { ReviewCorrectionPanel } from "@/components/review-correction-panel";
const delta = { totals: { gross: "-1000000", deductions: "0", net: "-1000000" }, workers: [{ workerId: "W001", change: "CHANGED", delta: { gross: "-1000000", deductions: "0", net: "-1000000" } }] };
beforeEach(() => { state.index = 0; state.replacementId = ""; state.view = { current: null, links: [], candidates: [], canLink: false, candidatesLimited: false, preview: null }; });
it("shows immutable lineage and exact signed deltas as evidence with plain-text reason/source", () => {
  state.view = { ...state.view as object, links: [{ id: "link-1", originalRunId: "original-1", replacementRunId: "replacement-1", originalCalculationHash: "a".repeat(64), replacementCalculationHash: "b".repeat(64), at: "2026-10-08T00:00:00Z", reason: "<script>unsafe</script>", source: "Ticket 12", delta }] };
  const html = renderToStaticMarkup(createElement(ReviewCorrectionPanel, { runId: "original-1" }));
  expect(html).toContain('href="/runs/original-1"'); expect(html).toContain('href="/runs/replacement-1"');
  expect(html).toContain("-1.00"); expect(html).toContain("Ticket 12"); expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  expect(html).not.toContain("Link this replacement");
});
it("exposes no link command for missing candidates or an absent exact preview", () => {
  state.view = { ...state.view as object, canLink: true };
  const html = renderToStaticMarkup(createElement(ReviewCorrectionPanel, { runId: "original-1" }));
  expect(html).toContain("No unsigned validated simulation");
  expect(html).toContain("disabled=");
  expect(html).toContain("does not sign off the replacement or authorize payment");
});
