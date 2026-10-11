import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { paidInYear, settledRunsOfYear, workerFacts } from "@/app/(app)/(workspace)/dashboard/dashboard-data";
import { ActivityPanel } from "@/components/dashboard/todo-activity";

const summary = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock("@/server/db/workers", () => ({ workerSummary: async () => { summary.calls++; if (summary.fail) throw new Error("decrypt failed"); return { total: 3, employees: 1, contractors: 1, unspecified: 1, unconfirmedWallets: 1 }; } }));

/** A chainable stand-in for the supabase query builder: every filter returns itself and awaiting it yields `result`. */
function client(results: Record<string, unknown>, seen: string[] = []) {
  return { from: (table: string) => { seen.push(table); const q: Record<string, unknown> = { then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => (results[table] instanceof Error ? Promise.reject(results[table]) : Promise.resolve(results[table])).then(ok, bad) }; for (const m of ["select", "eq", "in", "gte", "lte", "limit"]) q[m] = () => q; return q; } } as never;
}
const runs = [{ id: "r1", status: "SETTLED", period_end: "2026-01-31" }, { id: "r2", status: "RECONCILED", period_end: "2026-02-28" }];

describe("settledRunsOfYear", () => {
  it("returns the complete list, and null for a read error, a partial read or a thrown error", async () => {
    expect(await settledRunsOfYear(client({ payroll_runs: { data: runs, count: 2, error: null } }), "c", 2026)).toEqual(runs);
    expect(await settledRunsOfYear(client({ payroll_runs: { data: null, count: null, error: { message: "boom" } } }), "c", 2026)).toBeNull();
    expect(await settledRunsOfYear(client({ payroll_runs: { data: runs, count: 5, error: null } }), "c", 2026)).toBeNull(); // count says more rows exist
    expect(await settledRunsOfYear(client({ payroll_runs: new Error("network") }), "c", 2026)).toBeNull();
  });
});

describe("paidInYear", () => {
  it("sums settled obligations for payroll and payment roles", async () => {
    const result = await paidInYear(client({ obligations: { data: [{ amount: "1000000" }, { amount: 2500000 }], count: 2, error: null } }), "c", runs, 2026, ["PAYMENT_APPROVER"]);
    expect(result).toEqual({ year: 2026, value: "3.50", payments: 2, runs: 2, hiddenForRole: false });
  });
  it("gives a VIEWER no money figure and does not even query obligations", async () => {
    const seen: string[] = [];
    const result = await paidInYear(client({ obligations: { data: [{ amount: "1000000" }], count: 1, error: null } }, seen), "c", runs, 2026, ["VIEWER"]);
    expect(result).toMatchObject({ value: null, hiddenForRole: true, runs: 2 });
    expect(seen).toEqual([]);
  });
  it("reports none settled as zero runs, and unknown as null runs and value, never a zero amount", async () => {
    expect(await paidInYear(client({}), "c", [], 2026, ["VIEWER"])).toMatchObject({ value: null, runs: 0 });
    expect(await paidInYear(client({}), "c", null, 2026, ["PAYROLL_APPROVER"])).toMatchObject({ value: null, runs: null });
  });
  it("returns no value for a failed or partial obligations read", async () => {
    expect(await paidInYear(client({ obligations: { data: null, count: null, error: { message: "x" } } }), "c", runs, 2026, ["HR_APPROVER"])).toMatchObject({ value: null, runs: 2 });
    expect(await paidInYear(client({ obligations: { data: [{ amount: "1" }], count: 9, error: null } }), "c", runs, 2026, ["HR_APPROVER"])).toMatchObject({ value: null });
    expect(await paidInYear(client({ obligations: new Error("network") }), "c", runs, 2026, ["HR_APPROVER"])).toMatchObject({ value: null });
  });
});

describe("workerFacts", () => {
  it("gives payroll and payment roles the split and wallet count from the summary read", async () => {
    summary.calls = 0;
    expect(await workerFacts(client({}), "c", ["HR_APPROVER"])).toEqual({ total: 3, employees: 1, contractors: 1, unspecified: 1, unconfirmedWallets: 1 });
    expect(summary.calls).toBe(1);
  });
  it("gives a VIEWER only the head count, with no split and no wallet figure, and never reads worker metadata", async () => {
    summary.calls = 0;
    const facts = await workerFacts(client({ worker_directory: { count: 7, error: null } }), "c", ["VIEWER"]);
    expect(facts).toEqual({ total: 7, employees: null, contractors: null, unspecified: null, unconfirmedWallets: null });
    expect(summary.calls).toBe(0);
  });
  it("returns nothing, not zeros, when a read fails", async () => {
    summary.fail = true;
    expect(await workerFacts(client({}), "c", ["PAYMENT_APPROVER"])).toEqual({ total: null, employees: null, contractors: null, unspecified: null, unconfirmedWallets: null });
    summary.fail = false;
    expect((await workerFacts(client({ worker_directory: { count: null, error: { message: "x" } } }), "c", ["VIEWER"])).total).toBeNull();
  });
});

describe("ActivityPanel AI labels", () => {
  const item = (event: string) => ({ id: event, event, at: "2026-10-07T09:14:00Z", actorType: "ai", actor: "m", entityType: "x", entityId: "1", correlationId: null, refs: {}, href: null }) as never;
  it("calls only known proposals suggestions, and records any other AI event as recorded by AI", () => {
    const html = renderToStaticMarkup(ActivityPanel({ items: [item("ai.recon_classify"), item("ai.something_else")], unavailable: false, truncated: false, viewAllHref: "/audit" }));
    expect(html.match(/Suggested by AI, not applied/g)).toHaveLength(1);
    expect(html).toContain("Recorded by AI");
  });
});
