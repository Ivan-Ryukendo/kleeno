import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { EffectiveCompensationForm, scheduleCommand, type ScheduleView } from "@/components/effective-compensation-form";
import { WorkerRow } from "@/components/worker-forms";
const view: ScheduleView = { workerId: "11111111-1111-4111-8111-111111111111", active: true, revision: 2, baseline: { id: "22222222-2222-4222-8222-222222222222", version: 1, effectiveFrom: "0001-01-01", payType: "SALARIED", baseAmount: "1000000000", hourlyRate: "0", supersedesId: null }, history: [], impacts: [{ id: "33333333-3333-4333-8333-333333333333", status: "CALCULATION_VALIDATED", period_start: "2026-01-01", period_end: "2026-01-31" }], segments: null };
const draft = { effectiveFrom: "2026-01-16", base: "1234.000001", hourly: "0", reason: "Reviewed raise", source: "Approved policy C2", supersedesId: "" };
const key = "44444444-4444-4444-8444-444444444444";
it("binds reviewed impacts/baseline/revision and converts decimal money exactly without floats", () => {
  expect(scheduleCommand(view, draft.effectiveFrom, draft, key)).toMatchObject({ baseAmount: "1234000001", hourlyRate: "0", expectedRevision: 2, baselineCompensationId: view.baseline.id, baselineCompensationVersion: 1, impactedRunIds: [view.impacts[0].id], payType: "SALARIED", supersedesId: null, idempotencyKey: key });
});
it("blocks stale date previews, inactive workers, unsafe amounts and unreviewed replacements", () => {
  expect(() => scheduleCommand(view, "2026-01-15", draft, key)).toThrow("Review affected periods");
  expect(() => scheduleCommand({ ...view, active: false }, draft.effectiveFrom, draft, key)).toThrow("Inactive workers");
  for (const base of ["-1", "1e3", "0.0000001", "1000000001"]) expect(() => scheduleCommand(view, draft.effectiveFrom, { ...draft, base }, key)).toThrow();
  expect(() => scheduleCommand(view, draft.effectiveFrom, { ...draft, supersedesId: key }, key)).toThrow("same-date");
});
it("requires an explicit same-date active leaf when correcting a schedule", () => {
  const previous = { ...view.baseline, id: key, effectiveFrom: draft.effectiveFrom, version: 1, actor: "actor", at: "2026-01-01T00:00:00Z", reason: "Earlier", source: "Earlier" };
  const newer = { ...previous, id: view.workerId, version: 2, supersedesId: key };
  const changed = { ...view, history: [previous, newer] };
  expect(() => scheduleCommand(changed, draft.effectiveFrom, { ...draft, supersedesId: key }, key)).toThrow("same-date");
  expect(scheduleCommand(changed, draft.effectiveFrom, { ...draft, supersedesId: newer.id }, key).supersedesId).toBe(newer.id);
});
it("initial scheduling requires explicit impact review and infers no amounts or save permission", () => {
  const html = renderToStaticMarkup(createElement(EffectiveCompensationForm, { workerId: view.workerId, workerCode: "W001" }));
  expect(html).toContain("Effective date"); expect(html).toContain("Review affected periods");
  expect(html).toContain("No pay change can be saved yet");
  expect(html).not.toContain("Save reviewed schedule"); expect(html).not.toContain("1234");
});
it("pay scheduling is discoverable for payroll editors and absent for read-only payment reviewers", () => {
  const worker = { id: view.workerId, pseudonym: "W001", payType: "SALARIED", base: "1000.00", hourly: "0", walletAddress: null, walletConfirmed: false, active: true, leftOn: null, leftReason: null, history: [] };
  expect(renderToStaticMarkup(createElement(WorkerRow, { w: worker, canEdit: true, canConfirm: false }))).toContain("Schedule pay");
  expect(renderToStaticMarkup(createElement(WorkerRow, { w: worker, canEdit: false, canConfirm: true }))).not.toContain("Schedule pay");
});
