import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReviewCorrectionPanel } from "@/components/review-correction-panel";

it("announces a real loading state and explicitly limits corrections to review and handoff", () => {
  const html = renderToStaticMarkup(createElement(ReviewCorrectionPanel, { runId: "run-1" }));
  expect(html).toContain("Linked replacement review");
  expect(html).toContain("role=\"status\"");
  expect(html).toContain("does not instruct anyone to re-pay wages or recover an overpayment");
  expect(html).not.toContain("Link this replacement");
});
