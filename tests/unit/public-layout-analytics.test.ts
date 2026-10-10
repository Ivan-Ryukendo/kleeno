import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import PublicLayout from "@/app/(public)/layout";

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => createElement("span", { "data-testid": "public-analytics" }),
}));
afterEach(() => vi.unstubAllEnvs());
const render = () => renderToStaticMarkup(createElement(PublicLayout, null, createElement("main", { id: "main" }, "Public content")));

it.each(["development", "test"])("does not load analytics in %s", (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  const html = render();
  expect(html).not.toContain('data-testid="public-analytics"');
  expect(html).toContain("Public content");
  expect(html).toContain('href="/privacy"');
});

it("keeps analytics on production public pages", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(render()).toContain('data-testid="public-analytics"');
});
