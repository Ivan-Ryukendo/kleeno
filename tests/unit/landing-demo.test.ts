import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { columns, monthRows, monthSummary, months, parseUsd, usd, workers } from "@/components/landing-demo-data";
import { PayrollDemo } from "@/components/landing-payroll-demo";

// The landing-page payroll demo copies docs/mockups/payroll-table.html. Its sample numbers must agree with each other.

it("current run matches the mockup: 14 people, 12 matched, $79,102.00", () => {
  const s = monthSummary(monthRows(0));
  expect(workers).toHaveLength(14);
  expect(columns).toHaveLength(17);
  expect([s.workers, s.matched, s.review, s.hold]).toEqual([14, 12, 1, 1]);
  expect(usd(s.total)).toBe("$79,102.00");
  expect(s.footer.monthly).toBe("Sum $79,102.00");
  expect(s.footer.annual).toBe("Sum $949,224.00");
  expect(s.footer.months).toBe("Sum 164");
  expect(s.footer.paid).toBe("Sum $1,050,288.00");
});

it("Kenji is paid hours x $45 and past runs are fully resolved", () => {
  months.forEach((m, k) => {
    const kenji = monthRows(k).find((w) => w.code === "W004")!;
    expect(parseUsd(kenji.monthly)).toBe(m.kenjiHours * 45);
    expect(parseUsd(kenji.annual)).toBe(m.kenjiHours * 45 * 12);
    if (k > 0) expect(monthRows(k).every((w) => w.check === "matched")).toBe(true);
  });
});

it("every row adds up: cost = pay + tax, annual = pay x 12, after = pay + increase", () => {
  for (const w of monthRows(0)) {
    expect(parseUsd(w.monthlyCost)).toBeCloseTo(parseUsd(w.monthly) + parseUsd(w.tax), 2);
    expect(parseUsd(w.annual)).toBeCloseTo(parseUsd(w.monthly) * 12, 2);
    expect(parseUsd(w.after)).toBeCloseTo(parseUsd(w.monthly) + parseUsd(w.raise), 2);
  }
});

it("server-renders the Table tab only, with real table markup and no ARIA expanded state", () => {
  const html = renderToStaticMarkup(createElement(PayrollDemo));
  expect(html.match(/<tr class="group\/row">/g)).toHaveLength(14);
  expect(html.match(/<th scope="col"/g)).toHaveLength(18);
  expect(html).toContain('role="tablist"');
  expect(html.match(/role="tab"/g)).toHaveLength(4);
  expect(html).toContain("Matched 12 of 14");
  expect(html).not.toContain("Improve with AI"); // the Workflow tab mounts on first open
  expect(html).not.toContain("aria-expanded");
});
