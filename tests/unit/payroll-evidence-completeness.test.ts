import { beforeEach, expect, it, vi } from "vitest";
import { CONFIG } from "../fixtures/payroll/cases";
const mocks = vi.hoisted(() => ({ results: new Map<string, { data: unknown[] | null; error: { code: string } | null; count: number | null }>(), select: vi.fn(), transition: vi.fn(), open: vi.fn(), saved: vi.fn(), refsTable: "", refsCount: 1 as number | null, runStatus: "DATA_IMPORTED" }));
vi.mock("@/server/db/client", () => ({ db: () => reader, must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data == null) throw new Error("database unavailable"); return result.data; } }));
vi.mock("@/server/db/configs", () => ({ loadConfig: async () => ({ config: CONFIG, confirmedOverrideKeys: [] }) }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.open, openField: mocks.open, sealJson: vi.fn(), sealField: vi.fn() }));
vi.mock("@/server/ai/recon", () => ({ suggestForExceptions: vi.fn() }));
vi.mock("@/server/db/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/core/domain/transition", () => ({ applyTransition: mocks.transition }));
vi.mock("@/server/db/effective-compensation", () => ({ effectiveCompensationAccess: vi.fn(), effectiveScheduleRevisions: async () => new Map(), loadEffectiveCompensation: vi.fn() }));
vi.mock("@/server/db/calculations", () => ({ saveCalculation: mocks.saved, loadLines: vi.fn() }));
const run = { id: "run", status: "DATA_IMPORTED", config_version: 1, period_start: "2026-01-01", period_end: "2026-01-31" };
const reader = { from(table: string) {
  let columns = "";
  const query = { select: (...args: unknown[]) => { columns = String(args[0]); mocks.select(table, ...args); return query; }, eq: () => query, order: () => query, range: () => query, in: () => query, single: async () => ({ data: { adjustment_revision: 0 }, error: null }), maybeSingle: async () => ({ data: table === "calculations" ? null : { ...run, status: mocks.runStatus }, error: null }), then: (resolve: (value: unknown) => unknown) => resolve(table === mocks.refsTable && columns.includes("source_hash") ? { data: [], error: null, count: mocks.refsCount } : mocks.results.get(table) ?? { data: [], error: null, count: 0 }) };
  return query;
} };
import { loadInput, loadResolutions, reconcileRun } from "@/server/db/reconciliation";
import { listWorkers } from "@/server/db/workers";
import { calculateRun, loadRunAdjustments } from "@/server/db/calculate";
beforeEach(() => { vi.clearAllMocks(); mocks.results.clear(); mocks.refsTable = ""; mocks.refsCount = 1; mocks.runStatus = "DATA_IMPORTED"; mocks.transition.mockResolvedValue("RECONCILING"); });
const load = (table: string) => table === "timesheets" || table === "leave_records" ? loadInput("company", run) : table === "exceptions" ? loadResolutions("company", "run") : table === "run_adjustments" ? loadRunAdjustments(reader as never, "company", "run") : listWorkers(reader as never, "company");
it.each(["timesheets", "leave_records", "exceptions", "workers", "compensations", "run_adjustments"])("rejects truncated %s evidence before using partial financial data", async table => {
  mocks.results.set(table, { data: [], error: null, count: 1001 });
  await expect(load(table)).rejects.toThrow(/incomplete/i);
  expect(mocks.select).toHaveBeenCalledWith(table, expect.any(String), { count: "exact" });
  expect(mocks.open).not.toHaveBeenCalled();
});
it.each(["timesheets", "leave_records", "exceptions", "workers", "compensations", "run_adjustments"])("requires an exact count for %s even when the page is empty", async table => {
  mocks.results.set(table, { data: [], error: null, count: null });
  await expect(load(table)).rejects.toThrow(/incomplete/i);
});
it("rejects a full 1000-row API page when one imported work row is omitted", async () => {
  mocks.results.set("timesheets", { data: Array.from({ length: 1000 }, (_, index) => ({ id: `t${index}`, worker_id: "worker", work_date: "2026-01-01", hours: 1, approved_extra_hours: 0 })), error: null, count: 1001 });
  await expect(loadInput("company", run)).rejects.toThrow(/incomplete/i);
});
it("cannot advance a run with an incomplete open-exception read", async () => {
  mocks.results.set("exceptions", { data: [], error: null, count: 1 });
  await expect(reconcileRun({ companyId: "company", userId: "reviewer", roles: ["PAYROLL_APPROVER"] }, "run")).rejects.toThrow(/incomplete/i);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(mocks.transition.mock.calls[0][2].action).toBe("start_reconciliation");
});
it("preserves complete empty reads without inventing financial rows", async () => {
  await expect(loadInput("company", run)).resolves.toMatchObject({ workers: [], timesheets: [], leave: [] });
  await expect(loadResolutions("company", "run")).resolves.toEqual(new Map());
  await expect(listWorkers(reader as never, "company")).resolves.toEqual([]);
  await expect(loadRunAdjustments(reader as never, "company", "run")).resolves.toEqual(new Map());
});
it.each(["workers", "compensations"])("keeps failed %s schema reads blocking financial evidence", async table => {
  mocks.results.set(table, { data: null, error: { code: "42703" }, count: null });
  await expect(listWorkers(reader as never, "company")).rejects.toThrow("(42703)");
  expect(mocks.open).not.toHaveBeenCalled();
});
it.each(["timesheets", "leave_records", "actual_payments"])("cannot capture incomplete %s source references", async table => {
  mocks.runStatus = "READY_FOR_CALCULATION"; mocks.refsTable = table;
  await expect(calculateRun({ companyId: "company", userId: "reviewer", roles: ["PAYROLL_APPROVER"] }, "run")).rejects.toThrow("reference evidence is incomplete");
  expect(mocks.saved).not.toHaveBeenCalled(); expect(mocks.transition).not.toHaveBeenCalled();
});
it("cannot capture source references without an exact count", async () => {
  mocks.runStatus = "READY_FOR_CALCULATION"; mocks.refsTable = "timesheets"; mocks.refsCount = null;
  await expect(calculateRun({ companyId: "company", userId: "reviewer", roles: ["PAYROLL_APPROVER"] }, "run")).rejects.toThrow("reference evidence is incomplete");
  expect(mocks.saved).not.toHaveBeenCalled();
});
