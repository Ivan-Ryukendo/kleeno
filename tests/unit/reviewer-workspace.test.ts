import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineView } from "@/server/db/calculations";

const mocks = vi.hoisted(() => ({ lines: vi.fn(), decrypt: vi.fn(), readiness: vi.fn(), review: vi.fn(), thresholds: vi.fn() }));
vi.mock("@/server/db/client", () => ({ must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("scoped read unavailable"); return r.data; } }));
vi.mock("@/server/db/calculations", () => ({ loadLines: mocks.lines }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.decrypt }));
vi.mock("@/server/db/review-readiness", () => ({ reviewReadiness: mocks.readiness, VALIDATED_REVIEW_STATES: ["CALCULATION_VALIDATED"] }));
vi.mock("@/server/db/payroll-review", () => ({ loadPayrollReview: mocks.review }));
vi.mock("@/server/db/historical-thresholds", () => ({ loadHistoricalThresholds: mocks.thresholds }));
import { reviewerWorkspace } from "@/server/db/reviewer-workspace";

type Row = Record<string, unknown>;
const actor = { companyId: "company-a", userId: "reviewer", roles: ["HR_APPROVER"] as const };
const line = (workerId: string): LineView => ({ id: `line-${workerId}`, workerId, gross: 1000000n, deductions: 0n, net: 1000000n, trace: [{ component: "base", amount: 1000000n, source: "worker.compensation", rule: "BASE_SALARY", ruleVersion: 1, inputs: {}, step: 1 }] });
function fixture() {
  const rows: Record<string, Row[]> = {
    payroll_runs: [
      { id: "current", company_id: "company-a", status: "CALCULATION_VALIDATED", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 1 },
      { id: "baseline", company_id: "company-a", status: "CALCULATION_VALIDATED", period_start: "2026-08-01", period_end: "2026-08-31", config_version: 1 },
      { id: "foreign", company_id: "company-b", status: "CALCULATION_VALIDATED", period_start: "2026-07-01", period_end: "2026-07-31", config_version: 1 },
    ],
    calculations: ["current", "baseline"].map(id => ({ id: `calc-${id}`, run_id: id, company_id: "company-a", calculation_hash: `${id}-hash`, snapshot_enc: "encrypted" })),
    workers: ["W1", "W2"].map(id => ({ id, company_id: "company-a", pseudonym: id })),
  };
  const reads: { table: string; companyIds: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const read = { table, companyIds: [] as unknown[] }; reads.push(read);
    const filters: ((row: Row) => boolean)[] = [];
    let single = false;
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { if (key === "company_id") read.companyIds.push(value); filters.push(row => row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      lt(key: string, value: string) { filters.push(row => String(row[key]) < value); return query; },
      order() { return query; }, limit() { return query; },
      maybeSingle() { single = true; return query; },
      then(resolve: (value: unknown) => unknown) { const matched = (rows[table] ?? []).filter(row => filters.every(test => test(row))); return Promise.resolve({ data: single ? matched[0] ?? null : matched, error: null }).then(resolve); },
    };
    return query;
  });
  return { rows, reads, from, client: { from } as unknown as SupabaseClient };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lines.mockResolvedValue([line("W1"), line("W2")]);
  mocks.decrypt.mockResolvedValue({ entries: [{ worker: { workerId: "W1" } }, { worker: { workerId: "W2" } }] });
  mocks.readiness.mockResolvedValue({ readiness: { ready: true }, settings: {} });
  mocks.review.mockResolvedValue({ signoff: null });
  mocks.thresholds.mockResolvedValue({ revision: 0, version: null, configurationHash: null, rules: [], canConfigure: true });
});

describe("reviewer workspace evidence completeness", () => {
  it.each(["duplicate", "truncated", "foreign-worker"])("rejects %s calculation lines against the snapshot", async kind => {
    mocks.lines.mockResolvedValue(kind === "duplicate" ? [line("W1"), line("W1")] : kind === "truncated" ? [line("W1")] : [line("W1"), line("foreign-worker")]);
    await expect(reviewerWorkspace(fixture().client, actor, "current")).rejects.toThrow("incomplete");
  });
  it("rejects duplicate workers in immutable snapshot evidence", async () => {
    mocks.decrypt.mockResolvedValue({ entries: [{ worker: { workerId: "W1" } }, { worker: { workerId: "W1" } }] });
    await expect(reviewerWorkspace(fixture().client, actor, "current")).rejects.toThrow("incomplete");
  });
  it("requires explicit baseline selection and does not decrypt prior candidates", async () => {
    const f = fixture();
    const result = await reviewerWorkspace(f.client, actor, "current");
    expect(result).toMatchObject({ selectedBaselineId: null, comparison: { status: "NO_BASELINE", totals: null, workers: [] } });
    expect(result.baselines.map(v => v.id)).toEqual(["baseline"]);
    expect(mocks.lines).toHaveBeenCalledExactlyOnceWith(f.client, "company-a", "calc-current");
    expect(mocks.decrypt).toHaveBeenCalledExactlyOnceWith("company-a", "calculations", "snapshot_enc", "calc-current", "encrypted");
  });
  it("uses only the selected tenant-scoped prior result and preserves trace links", async () => {
    const f = fixture();
    const result = await reviewerWorkspace(f.client, actor, "current", "baseline");
    expect(result).toMatchObject({ selectedBaselineId: "baseline", comparison: { status: "COMPARED", baseline: { id: "baseline", companyId: "company-a" }, workers: [{ currentTraceId: "line-W1" }, { currentTraceId: "line-W2" }] } });
    expect(f.reads.every(read => read.companyIds.includes("company-a"))).toBe(true);
    expect(mocks.lines).toHaveBeenNthCalledWith(2, f.client, "company-a", "calc-baseline");
  });
  it("serializes exact configured findings with immutable threshold and source references", async () => {
    mocks.thresholds.mockResolvedValue({ revision: 1, version: "threshold-version", configurationHash: "threshold-hash", rules: [{ id: "net-change", component: null, absolute: "1000000", percent: null }], canConfigure: true });
    mocks.lines.mockImplementation(async (_reader, _company, id) => id === "calc-current" ? [{ ...line("W1"), gross: 2000000n, net: 2000000n, trace: [{ ...line("W1").trace[0], amount: 2000000n }] }, line("W2")] : [line("W1"), line("W2")]);
    const result = await reviewerWorkspace(fixture().client, actor, "current", "baseline");
    expect(result).toMatchObject({ thresholdComponents: ["base"], findings: { status: "EVALUATED", configurationHash: "threshold-hash", findings: [{ workerId: "W1", previous: "1.00", current: "2.00", delta: "1.00", currentHash: "current-hash", baselineHash: "baseline-hash", thresholdVersion: "threshold-version", previousTrace: [{ amount: "1.00" }], currentTrace: [{ amount: "2.00" }] }] } });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("foreign baseline evidence remains unavailable and undecrypted", async () => {
    const f = fixture();
    expect(await reviewerWorkspace(f.client, actor, "current", "foreign")).toMatchObject({ selectedBaselineId: null, comparison: { status: "NO_BASELINE", totals: null, reason: "Selected baseline is unavailable or not comparable" } });
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
  });
  it("foreign current run or calculation evidence is rejected before decryption", async () => {
    const f = fixture();
    await expect(reviewerWorkspace(f.client, actor, "foreign")).rejects.toThrow("scoped read unavailable");
    expect(mocks.decrypt).not.toHaveBeenCalled();
    f.rows.calculations[0].company_id = "company-b";
    await expect(reviewerWorkspace(f.client, actor, "current")).rejects.toThrow("scoped read unavailable");
    expect(mocks.lines).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each(["VIEWER", "OWNER"] as const)("denies %s before any query or sensitive decryption", async role => {
    const f = fixture();
    await expect(reviewerWorkspace(f.client, { ...actor, roles: [role] }, "current")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.from).not.toHaveBeenCalled(); expect(mocks.lines).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
  });
});
