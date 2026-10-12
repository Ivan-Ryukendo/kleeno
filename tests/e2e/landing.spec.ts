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
    const { top, height } = await page.locator("#proof").evaluate((el) => ({ top: el.getBoundingClientRect().top + window.scrollY, height: (el as HTMLElement).offsetHeight }));
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

// LP.1 fix 2: FAQ opens and closes with a smooth height transition; content below moves gradually, never in one jump.
async function sampleToggle(page: Page, index: number) {
  return page.evaluate(
    (i) =>
      new Promise<{ tops: number[]; open: boolean }>((resolve) => {
        const items = [...document.querySelectorAll("#faq details")];
        const below = items[items.length - 1] === items[i] ? document.querySelector("#join")! : items[i + 1];
        const tops: number[] = [];
        const t0 = performance.now();
        (items[i].querySelector("summary") as HTMLElement).click();
        const tick = () => {
          tops.push(below.getBoundingClientRect().top);
          if (performance.now() - t0 < 600) requestAnimationFrame(tick);
          else resolve({ tops, open: (items[i] as HTMLDetailsElement).open });
        };
        requestAnimationFrame(tick);
      }),
    index,
  );
}

function expectGradual(tops: number[]) {
  const total = Math.abs(tops[tops.length - 1] - tops[0]);
  expect(total).toBeGreaterThan(20);
  const steps = tops.slice(1).map((t, i) => Math.abs(t - tops[i]));
  expect(Math.max(...steps)).toBeLessThan(total * 0.6); // spread over several frames, not a snap
  expect(steps.filter((s) => s > 0.5).length).toBeGreaterThanOrEqual(4);
}

for (const width of [375, 1280]) {
  test(`FAQ opens, closes and switches smoothly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator("#faq").scrollIntoViewIfNeeded();
    const opened = await sampleToggle(page, 0);
    expect(opened.open).toBe(true);
    expectGradual(opened.tops);
    await expect(page.locator("#faq details").nth(0).locator("p")).toBeVisible();
    await expect(page.locator("#faq details").nth(0).locator("summary span")).toHaveClass(/rotate-45/);
    const second = await sampleToggle(page, 1);
    expect(second.open).toBe(true);
    expectGradual(second.tops);
    const closed = await sampleToggle(page, 0);
    expect(closed.open).toBe(false);
    expectGradual(closed.tops);
    await noHorizontalScroll(page);
  });
}

test("FAQ is keyboard operable and instant under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const first = page.locator("#faq details").nth(0);
  await first.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveJSProperty("open", true);
  expect(await first.locator("div").evaluate((d) => d.getAnimations().length)).toBe(0);
  await page.keyboard.press("Space");
  await expect(first).toHaveJSProperty("open", false);
});

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
