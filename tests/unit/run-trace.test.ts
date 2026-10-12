import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/server/db/client", () => ({ must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/db/calculations", () => ({ loadLines: vi.fn() }));
vi.mock("@/server/arc/reader", () => ({ EXPLORER_TX: (hash: string) => `https://testnet.arcscan.app/tx/${hash}` }));
vi.mock("@/server/crypto", () => ({ openJson: vi.fn() }));
import { loadLines } from "@/server/db/calculations";
import { runView } from "@/server/db/views";

function fixture(failedTable?: string, missingRun = false) {
  const filters: [string, string, unknown][] = [];
  const rows: Record<string, unknown> = { payroll_runs: missingRun ? null : { id: "run", company_id: "company", mode: "SIMULATION" }, calculations: { id: "calc", calculation_hash: "approved-hash" }, workers: [{ id: "worker", pseudonym: "W001" }] };
  const client = { from(table: string) {
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push([table, key, value]); return query; }, limit() { return query; }, maybeSingle() { return query; }, then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: table in rows ? rows[table] : [], error: table === failedTable ? { message: "private provider detail" } : null })); } };
    return query;
  } } as unknown as SupabaseClient;
  return { client, filters };
}

describe("authorized calculation trace read model", () => {
  it("preserves exact source, inputs, rule version and steps for amount inspection", async () => {
    vi.mocked(loadLines).mockResolvedValue([{ id: "line", workerId: "worker", gross: 1000000n, deductions: 0n, net: 1000000n, trace: [{ component: "gross", source: "timesheet:record-1", rule: "hourly_rate", ruleVersion: 7, inputs: { hours: "2", rate: "0.50" }, step: 1, amount: 1000000n }] }]);
    const { client, filters } = fixture();
    const view = await runView(client, "company", "run", ["HR_APPROVER"]);
    expect(view?.lines[0].trace[0]).toEqual({ component: "gross", source: "timesheet:record-1", inputs: { hours: "2", rate: "0.50" }, rule: "hourly_rate", ruleVersion: 7, step: 1, amount: "1.00" });
    expect(filters.filter(([, key]) => key === "company_id").every(([, , value]) => value === "company")).toBe(true);
    expect(loadLines).toHaveBeenCalledWith(client, "company", "calc");
  });
  it.each([undefined, ["VIEWER"], ["OWNER"]] as const)("does not load financial detail without a financial role (%s)", async (roles) => {
    vi.mocked(loadLines).mockClear();
    const { client, filters } = fixture();
    const view = await runView(client, "company", "run", roles);
    expect(view).toMatchObject({ financial: false, lines: [], obligations: [], variance: null, netTotal: null });
    expect(loadLines).not.toHaveBeenCalled();
    expect(filters.some(([table]) => ["workers", "obligations", "actual_payments", "variance_findings"].includes(table))).toBe(false);
  });
  it.each(["payroll_runs", "calculations"])("fails closed on a %s read error", async (table) => {
    const { client } = fixture(table);
    await expect(runView(client, "company", "run")).rejects.toThrow(table === "payroll_runs" ? "run read failed" : "calculation read failed");
  });
  it("does not reveal a run outside the authorized company", async () => {
    const { client } = fixture(undefined, true);
    expect(await runView(client, "company", "run")).toBeNull();
  });
});
