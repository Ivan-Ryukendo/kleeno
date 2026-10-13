import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/views", () => ({ periodView: async () => { throw new Error("private failure"); } }));
import { loadFrameData, type FrameData } from "@/components/payroll/frame-data";
import { RunFrame } from "@/components/payroll/run-frame";

const id = "10000000-0000-4000-8000-000000000001";
const base = { id, mode: "LIVE_TESTNET", status: "CALCULATION_VALIDATED", periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const data = (over: Partial<FrameData["facts"]> = {}): FrameData => ({ facts: { workers: 14, autoMatched: { count: 12, total: 14 }, openExceptions: 0, ...over }, runs: [{ id, label: "October 2026", status: "CALCULATION_VALIDATED" }] });
const render = (p: Partial<Parameters<typeof RunFrame>[0]> = {}) => renderToStaticMarkup(RunFrame({ run: base, current: "table", data: data(), canPayroll: true, canPay: false, hrefFor: (r) => `/runs/${r}`, hint: "hint", ...p }));

describe("payroll run frame", () => {
  it("shows title, period, tabs and the summary facts", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain("October 2026");
    expect(html).toContain('aria-label="Run views"');
    expect(html).toContain("14</b> workers");
    expect(html).toContain("12</b> of 14 records matched automatically");
  });
  it("hides unknown figures instead of showing zeros", () => {
    const html = render({ data: data({ workers: null, autoMatched: null, openExceptions: null }) });
    expect(html).not.toContain("workers");
    expect(html).not.toContain("matched automatically");
    expect(html).not.toContain(">0<");
  });
  it("links approval only for payroll roles on live runs after validation", () => {
    expect(render()).toContain(`href="/runs/${id}#next-step"`);
    expect(render({ canPayroll: false })).not.toContain("Review and approve");
    expect(render({ run: { ...base, mode: "SIMULATION" } })).not.toContain("Review and approve");
    const early = render({ run: { ...base, status: "EXCEPTIONS_PENDING" }, data: data({ openExceptions: 2 }) });
    expect(early).toContain('aria-disabled="true"');
    expect(early).toContain("Approval opens when exceptions are closed");
    expect(early).toContain("2 needs review");
  });
  it("marks no tab current for the Needs review sub-view", () => {
    expect(render({ current: null })).not.toContain('aria-current="page"');
  });
  it("survives failed reads with unknown facts", async () => {
    const out = await loadFrameData({} as never, { companyId: "c", userId: "u", roles: [] }, id);
    expect(out.facts).toEqual({ workers: null, autoMatched: null, openExceptions: null });
    expect(out.runs).toEqual([]);
  });
});
