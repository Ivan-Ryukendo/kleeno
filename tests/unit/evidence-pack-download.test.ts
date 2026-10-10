import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it } from "vitest";
import { EvidencePackDownload } from "@/components/evidence-pack-download";

it("offers evidence only after sign-off/export and explains its scope with keyboard accessible control", () => {
  const html = renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: true }));
  expect(html).toContain("Download calculation evidence ZIP");
  expect(html).toContain("aria-describedby=");
  expect(html).toContain("Recorded human review");
  expect(html).toContain("does not prove delivery or payment settlement");
  expect(html).not.toContain("disabled=");
  const blocked = renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: false }));
  expect(blocked).toContain("disabled=");
  expect(blocked).toContain("Sign off and generate the reviewed CSV first");
});
