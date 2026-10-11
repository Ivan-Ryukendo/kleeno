import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ schedules: vi.fn(), workers: vi.fn(), saved: vi.fn(), verified: vi.fn(), step: vi.fn(), open: vi.fn(), lines: vi.fn(), paidCount: 0 as number | null }));
vi.mock("@/server/db/effective-compensation", () => ({ effectiveCompensationAccess: vi.fn(), effectiveScheduleRevisions: mocks.schedules, loadEffectiveCompensation: vi.fn() }));
vi.mock("@/server/db/reconciliation", () => ({ loadRun: async () => ({ id: "run", status: "CALCULATED", config_version: 1, period_start: "2026-01-01", period_end: "2026-01-31" }), loadInput: vi.fn(() => { throw new Error("current inputs must not replace captured evidence"); }), loadResolutions: vi.fn() }));
vi.mock("@/server/db/configs", () => ({ loadConfig: async () => ({ config: { version: 1, varianceTolerance: "0.01" } }) }));
vi.mock("@/server/db/workers", () => ({ listWorkers: mocks.workers }));
vi.mock("@/server/db/calculations", () => ({ saveCalculation: mocks.saved, loadLines: mocks.lines }));
vi.mock("@/core/workflow/evidence-pack", () => ({ verifyCapturedCalculation: mocks.verified }));
vi.mock("@/core/domain/transition", () => ({ applyTransition: mocks.step }));
vi.mock("@/server/db/runs", () => ({ runStore: {} }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.open, openField: vi.fn(), sealJson: vi.fn() }));
vi.mock("@/server/db/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, order: () => q, range: () => q, maybeSingle: async () => ({ data: { id: "calculation", config_version: 1, calculation_hash: "a".repeat(64), snapshot_enc: "CAPTURED" }, error: null }), then: (resolve: (value: unknown) => unknown) => resolve({ data: table === "actual_payments" ? [] : null, error: null, count: mocks.paidCount }) }; return q;
} }), must: (result: { data: unknown }) => result.data }));
import { calculateRun } from "@/server/db/calculate";
it("recovers a captured calculation using its immutable snapshot rather than current rates or a new timeline", async () => {
  mocks.open.mockResolvedValue({ captured: true }); mocks.lines.mockResolvedValue([]);
  mocks.verified.mockReturnValue({ calculated: { calculationHash: "a".repeat(64), lines: [{ workerId: "worker", net: 100n }] } });
  mocks.step.mockResolvedValue("CALCULATION_VALIDATED");
  await expect(calculateRun({ companyId: "company", userId: "reviewer", roles: ["PAYROLL_APPROVER"] }, "run")).resolves.toMatchObject({ calculationId: "calculation", calculationHash: "a".repeat(64), status: "CALCULATION_VALIDATED" });
  expect(mocks.verified).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { captured: true }, calculation: { id: "calculation", configVersion: 1, calculationHash: "a".repeat(64) } }));
  expect(mocks.schedules).not.toHaveBeenCalled(); expect(mocks.workers).not.toHaveBeenCalled(); expect(mocks.saved).not.toHaveBeenCalled();
});
it.each([1, null])("blocks captured-run variance with incomplete imported payment count %s", async count => {
  mocks.paidCount = count;
  mocks.open.mockResolvedValue({ captured: true }); mocks.lines.mockResolvedValue([]);
  mocks.verified.mockReturnValue({ calculated: { lines: [] } });
  try {
    await expect(calculateRun({ companyId: "company", userId: "reviewer", roles: ["PAYROLL_APPROVER"] }, "run")).rejects.toThrow("actual payments evidence is incomplete");
  } finally { mocks.paidCount = 0; }
});
