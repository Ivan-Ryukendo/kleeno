import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({ env: { SITE_URL: "http://127.0.0.1:3000" } }));
const { default: LandingPage, metadata } = await import("@/app/(public)/page");

const html = renderToStaticMarkup(createElement(LandingPage));
const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

it("keeps the SEO metadata and FAQ structured data", () => {
  expect(metadata.title).toEqual({ absolute: "Kleeno · AI payroll reconciliation for teams that pay contractors" });
  expect(metadata.alternates).toEqual({ canonical: "/" });
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  const faq = ld["@graph"].find((g: { "@type": string }) => g["@type"] === "FAQPage");
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(8);
});

it("has one h1 inside a horizontally clipped main landmark", () => {
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  expect(html).toMatch(/<main id="main" class="[^"]*overflow-x-hidden/);
});

it("keeps the waitlist anchor, form and public links", () => {
  expect(html).toContain('id="join"');
  expect(html).toContain('href="#join"');
  expect(html).toContain('href="#how-it-works"');
  expect(html).toContain('href="/privacy"');
  expect(html).toMatch(/type="email"/);
  for (const id of ["how-it-works", "proof", "safety", "who-its-for", "faq"]) expect(html).toContain(`id="${id}"`);
});

it("renders product-style samples without captions, and stays honest", () => {
  // Owner (LP.1 fix 3): no "illustrative/synthetic/placeholder" captions; the renderings copy the product mockups instead.
  expect(text).not.toMatch(/illustrative|synthetic|placeholder/i);
  expect(text).toContain("SIMULATION");
  expect(text).toContain("Arc testnet USDC, no real funds");
  expect(text).toContain("Matched 12 of 14");
  for (const header of ["Name", "Check", "Pay type", "Monthly pay"]) expect(html).toContain(`>${header}</th>`);
  // Wallets and transactions only as short fragments, never a full address or hash.
  expect(text).not.toMatch(/0x[0-9a-f]{40}/i);
  expect(text).not.toMatch(/SECTION\s*\d|QUESTION\s*\d|testimonial|trusted by/i);
  // CSP img-src is 'self' data: blob:, so no remote images (picsum or otherwise).
  expect(html).not.toMatch(/<img[^>]+src="https?:/);
  expect(html).not.toContain("picsum");
});

it("uses a gapless dense bento and motion hooks that degrade to static markup", () => {
  expect(html).toContain("grid-flow-dense");
  expect(html).toContain("data-pin-section");
  expect(html).toContain("data-scrub");
  // Content is never hidden by default: GSAP sets initial states at runtime, only without reduced motion.
  expect(html).not.toMatch(/data-(rise|proof)[^>]*style="[^"]*opacity:\s*0/);
});

it("exposes the how-it-works accordion as buttons with aria-expanded", () => {
  expect(html.match(/aria-expanded="(true|false)"/g)).toHaveLength(4);
  expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
});

it("follows DESIGN.md §13: small corners, no orange orbit motif, no GitHub link, no invented claims", () => {
  expect(html).not.toMatch(/rounded-full|rounded-\[(1\.25|2|2\.5)rem\]/);
  expect(html).not.toMatch(/orbit/);
  expect(html).not.toMatch(/github/i);
  expect(text).not.toMatch(/\d+\+?\s*(companies|customers|teams|pilots)|trusted by|in production/i);
});
