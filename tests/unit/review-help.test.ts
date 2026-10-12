import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReviewHelp } from "@/components/review-help";
it("explains the full supported review journey, limits and separate payment outcome", () => {
  const html = renderToStaticMarkup(createElement(ReviewHelp));
  for (const text of ["Prepare the policy", "Import the period", "Resolve exceptions", "Inspect the calculation", "Record a fresh review", "Track the handoff", "10,000", "5 MB", "10 MB", "20 MB", "SIMULATION cannot pay", "Manual acknowledgement is not settlement", "Names stay in your local name key"]) expect(html).toContain(text);
  for (const href of ["/configuration", "/import", "/exceptions", "/dashboard#pay-runs"]) expect(html).toContain(`href="${href}"`);
  expect(html).not.toMatch(/guaranteed|never wrong|24\/7/i);
});
