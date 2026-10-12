import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Public landing page (LP.1). Needs no database. Set LP_SHOTS_DIR to also save full-page screenshots.
const shots = process.env.LP_SHOTS_DIR;

async function noHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
}

async function h1Lines(page: Page) {
  return page.locator("h1").evaluate((h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)));
}

for (const width of [375, 1280]) {
  test(`landing at ${width}px: wide hero, no horizontal scroll, working CTAs`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payroll that can't pay the wrong person.");
    expect(await h1Lines(page)).toBeLessThanOrEqual(3);
    await noHorizontalScroll(page);
    // scroll the whole page so scroll-triggered motion runs, then re-check overflow
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    });
    await noHorizontalScroll(page);
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(page.locator('a[href="/privacy"]').first()).toBeAttached();
    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shots, `landing-${width}-top.png`) });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload();
      await page.screenshot({ path: path.join(shots, `landing-${width}-full.png`), fullPage: true });
    }
  });
}

// Regression (LP.1 fix 1): a filter tween from "none" started at brightness(0) and rendered proof cards solid black.
for (const width of [1280, 375]) {
  test(`proof cards never go black or lose their text while scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(800);
    const { top, height } = await page.locator("#proof").evaluate((el) => ({ top: el.getBoundingClientRect().top + window.scrollY, height: el.offsetHeight }));
    for (let y = top - 900; y < top + height; y += 120) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(120);
      const cards = await page.locator("[data-proof]").evaluateAll((els) =>
        els.map((e) => {
          const s = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          const heading = e.querySelector("h3")!;
          return { visible: r.bottom > 0 && r.top < window.innerHeight, opacity: Number(s.opacity), filter: s.filter, bg: s.backgroundColor, text: heading.textContent ?? "", headingColor: getComputedStyle(heading).color };
        }),
      );
      for (const c of cards.filter((c) => c.visible)) {
        expect(c.filter, `filter at y=${y}`).toBe("none");
        expect(c.opacity, `opacity at y=${y}`).toBeGreaterThanOrEqual(0.4);
        expect(c.bg).not.toMatch(/^rgba?\(0, 0, 0(, 1)?\)$/);
        expect(c.bg).not.toBe("rgba(0, 0, 0, 0)");
        expect(c.text.length).toBeGreaterThan(0);
        expect(c.headingColor).not.toBe(c.bg);
      }
    }
  });
}

test("reduced motion shows everything statically, with no pinning", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator("#proof").scrollIntoViewIfNeeded();
  expect(await page.locator(".pin-spacer").count()).toBe(0);
  const opacities = await page.locator("[data-proof], [data-rise], [data-word]").evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  expect(opacities.every((o) => o === "1")).toBe(true);
});

test("how-it-works accordion works with keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const check = page.getByRole("button", { name: "Check" });
  await check.focus();
  await expect(check).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Policy" })).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveAttribute("aria-expanded", "true");
});
