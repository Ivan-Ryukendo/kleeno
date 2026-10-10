import { beforeEach, expect, it, vi } from "vitest";
import { parseUsdc } from "@/core/money";
import { CONFIG } from "../fixtures/payroll/cases";
const mocks = vi.hoisted(() => ({ access: vi.fn(), timeline: vi.fn(), run: vi.fn(), input: vi.fn(), resolutions: vi.fn(), cfg: vi.fn(), workers: vi.fn(), adjustments: vi.fn(), rpc: vi.fn(), captured: false }));
vi.mock("@/server/db/effective-compensation", () => ({ effectiveCompensationAccess: mocks.access, loadEffectiveCompensation: mocks.timeline }));
vi.mock("@/server/db/reconciliation", () => ({ loadRun: mocks.run, loadInput: mocks.input, loadResolutions: mocks.resolutions }));
vi.mock("@/server/db/configs", () => ({ loadConfig: mocks.cfg }));
vi.mock("@/server/db/workers", () => ({ listWorkers: mocks.workers }));
vi.mock("@/server/db/calculate", () => ({ loadRunAdjustments: mocks.adjustments }));
vi.mock("@/server/crypto", async () => { const { canonicalHash } = await import("@/core/canonical"); return { fingerprint: async (_company: string, value: unknown) => canonicalHash(value) }; });
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc, from(table: string) { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "calculations" ? mocks.captured ? { id: "captured" } : null : { adjustment_revision: 0 }, error: null }) }; return q; } }), must: (result: { data: unknown; error: unknown }) => { if (result.error || !result.data) throw new Error("unavailable"); return result.data; } }));
import { previewEffectiveCompensation } from "@/server/db/effective-compensation-preview";
const companyId = "10000000-0000-4000-8000-000000000001", workerId = "20000000-0000-4000-8000-000000000002", runId = "30000000-0000-4000-8000-000000000003", baselineId = "40000000-0000-4000-8000-000000000004";
const who = { companyId, userId: companyId, roles: ["HR_APPROVER"] as const, correlationId: "test" };
const config = { ...CONFIG, scheduledHoursPerPeriod: "8", weeklyOvertimeThresholdHours: "1000", deductions: [{ code: "TAX", label: "Tax", percent: "10" }], prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };
const evidence = { config, period: { start: "2026-01-01", end: "2026-01-31" }, workers: [{ id: workerId, payType: "SALARIED" }], timesheets: [{ id: "t1", workerId, date: "2026-01-10", hours: "8", approvedExtraHours: "0", seq: 1 }], leave: [] };
const proposal = { runId, effectiveFrom: "2026-01-16", payType: "SALARIED" as const, baseAmount: parseUsdc("6200").toString(), hourlyRate: "0", expectedRevision: 0, baselineCompensationId: baselineId, baselineCompensationVersion: 1, supersedesId: null };
beforeEach(() => {
  vi.resetAllMocks(); mocks.captured = false;
  mocks.run.mockResolvedValue({ id: runId, status: "READY_FOR_CALCULATION", config_version: 1, period_start: evidence.period.start, period_end: evidence.period.end });
  mocks.cfg.mockResolvedValue({ config, confirmedOverrideKeys: [] }); mocks.input.mockResolvedValue(evidence); mocks.resolutions.mockResolvedValue(new Map());
  mocks.timeline.mockResolvedValue({ active: true, revision: 0, baseline: { id: baselineId, version: 1, effectiveFrom: "0001-01-01", payType: "SALARIED", baseAmount: parseUsdc("3100").toString(), hourlyRate: "0", supersedesId: null }, history: [] });
  mocks.workers.mockResolvedValue([{ id: workerId, pseudonym: "W001", payType: "SALARIED", metadata: {} }]);
  mocks.adjustments.mockResolvedValue(new Map([[workerId, [{ id: "bonus", kind: "BONUS", amount: "100", reason: "PRIVATE-NOTE" }, { id: "fixed", kind: "FIXED_DEDUCTION", amount: "20", reason: "PRIVATE-NOTE" }]]]));
});
it("previews exact actual inputs with additions/deductions once and explicit prospective source, without a write", async () => {
  const view = await previewEffectiveCompensation({} as never, who, workerId, proposal);
  expect(view.before).toMatchObject({ gross: "3200000000", deductions: "340000000", net: "2860000000" });
  expect(view.after).toMatchObject({ gross: "4800000000", deductions: "500000000", net: "4300000000" });
  expect(view.delta).toEqual({ gross: "1600000000", deductions: "160000000", net: "1440000000" });
  expect(view.authority).toBe("PREVIEW_ONLY"); expect(view.proposal.recorded).toBe(false); expect(JSON.stringify(view)).not.toContain("PRIVATE-NOTE"); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns zero monetary difference when the future proposal is outside the selected period", async () => {
  const view = await previewEffectiveCompensation({} as never, who, workerId, { ...proposal, effectiveFrom: "2026-02-01" });
  expect(view.delta).toEqual({ gross: "0", deductions: "0", net: "0" });
});
it("blocks captured, foreign/unavailable, unresolved and changed baseline evidence", async () => {
  mocks.captured = true; await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("captured");
  mocks.captured = false; mocks.run.mockRejectedValueOnce(new Error("Run not found")); await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("Run not found");
  mocks.input.mockResolvedValue({ ...evidence, timesheets: [] }); await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("Resolve");
  mocks.input.mockResolvedValue(evidence); await expect(previewEffectiveCompensation({} as never, who, workerId, { ...proposal, expectedRevision: 1 })).rejects.toThrow("changed");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails on input/decision/profile drift or access revocation before returning private results", async () => {
  mocks.input.mockResolvedValueOnce(evidence).mockResolvedValueOnce({ ...evidence, timesheets: [{ ...evidence.timesheets[0], hours: "9" }] });
  await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("changed");
  mocks.input.mockResolvedValue(evidence); mocks.access.mockRejectedValueOnce(new Error("Current membership revoked"));
  await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("Current membership"); expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(["decisions", "profile", "adjustments"])("detects %s drift even when run status stays ready", async kind => {
  if (kind === "decisions") mocks.resolutions.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map([["changed-human-decision", "KEEP_WORK"]]));
  if (kind === "profile") mocks.workers.mockResolvedValueOnce([{ id: workerId, pseudonym: "W001", payType: "SALARIED", metadata: {} }]).mockResolvedValueOnce([{ id: workerId, pseudonym: "W001", payType: "SALARIED", metadata: { tags: ["changed"] } }]);
  if (kind === "adjustments") mocks.adjustments.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map([[workerId, [{ id: "new", kind: "BONUS", amount: "1", reason: "Reviewed" }]]]));
  await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("changed"); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("refuses pooled salaried overtime in a multi-rate preview and rejects ambiguous supersession", async () => {
  const scoped = { ...config, scheduledHoursPerPeriod: "4", weeklyOvertimeThresholdHours: "4" };
  mocks.cfg.mockResolvedValue({ config: scoped, confirmedOverrideKeys: [] });
  mocks.input.mockResolvedValue({ ...evidence, config: scoped, timesheets: [{ ...evidence.timesheets[0], approvedExtraHours: "4" }] });
  await expect(previewEffectiveCompensation({} as never, who, workerId, proposal)).rejects.toThrow("dated approvedOvertimeHours");
  mocks.cfg.mockResolvedValue({ config, confirmedOverrideKeys: [] }); mocks.input.mockResolvedValue(evidence);
  await expect(previewEffectiveCompensation({} as never, who, workerId, { ...proposal, supersedesId: companyId })).rejects.toThrow("supersession"); expect(mocks.rpc).not.toHaveBeenCalled();
});
