import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(app)/(workspace)/dashboard/page";

const state = vi.hoisted(() => ({ ready: false, signed: false, exported: false, outcome: null as string | null, denied: false, failed: false, periodFailed: false, activityFailed: false, reads: 0 }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/display-timezone", () => ({ viewerTimeZone: async () => "UTC" }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", userId: "actor", roles: [state.denied ? "VIEWER" : "HR_APPROVER"] }, client: {} }) }));
vi.mock("@/server/db/company", () => ({ getCompany: async () => ({ onboardedAt: "2026-10-01", profile: { timezone: "UTC", payFrequency: "MONTHLY", payDay: 31 } }), setupFacts: async () => ({ teamInvited: true, workers: 1, policyApproved: true, runs: 1 }) }));
vi.mock("@/server/db/table-views", () => ({ initialTable: async () => null }));
vi.mock("@/components/table-view", () => ({ TableView: () => null }));
vi.mock("@/components/new-run-form", () => ({ NewRunForm: () => null }));
vi.mock("@/components/period-stepper", () => ({ PeriodStepper: () => null }));
vi.mock("@/components/audit-timeline", () => ({ AuditTimeline: () => null }));
vi.mock("@/server/db/reconciliation", () => ({ listExceptions: async () => [] }));
vi.mock("@/app/(app)/(workspace)/dashboard/dashboard-data", () => ({
  paidYearToDate: async () => ({ year: 2026, value: null, payments: 0, runs: 0, capped: false, hiddenForRole: false }),
  workerFacts: async () => ({ total: 1, employees: 1, contractors: 0, unspecified: 0, unconfirmedWallets: 0 }),
}));
vi.mock("@/server/db/views", () => ({
  dashboardView: async () => ({ company: { name: "Synthetic Company", live_payments_enabled: false, guard_address: null }, runs: [], selected: { id: "run-1", period_start: "2026-10-01", period_end: "2026-10-31", mode: "SIMULATION", status: "CALCULATION_VALIDATED", config_version: 1 } }),
  periodSteps: () => [], periodView: async () => { if (state.periodFailed) throw new Error("db audit run references failed (PGRST205): PRIVATE_DRIVER_DETAIL"); return { workers: 1, autoMatched: null, openExceptions: 0, netTotal: "125.00", settled: 0, obligations: 0, canSign: false, activity: { items: [], graphTruncated: false, unavailable: state.activityFailed } }; },
}));
vi.mock("@/server/db/reviewer-summary", () => ({ reviewerSummary: async () => {
  state.reads++; if (state.failed) throw new Error("synthetic read failed");
  return { settings: null, readiness: { ready: state.ready, received: state.ready ? 1 : 0, expected: 1, cutoff: null, blockers: state.ready ? [] : ["Company cutoff is not configured"], items: [] }, canReview: true, review: { revision: 0, calculationId: "calculation-1", calculationHash: "a".repeat(64), signoff: state.signed ? { id: "signed-1", at: "2026-10-07" } : null, export: state.exported ? { id: "export-1", formatVersion: 1, at: "2026-10-07" } : null, acknowledgement: state.outcome ? { status: state.outcome, reference: "Synthetic ticket" } : null } };
} }));

const render = async () => renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
describe("dashboard review journey", () => {
  beforeEach(() => { Object.assign(state, { ready: false, signed: false, exported: false, outcome: null, denied: false, failed: false, periodFailed: false, activityFailed: false, reads: 0 }); });
  it("leads with explicit readiness blockers rather than no-action or a fabricated ready percentage", async () => {
    const html = await render();
    expect(html).toContain("Review readiness");
    expect(html).toContain("Company cutoff is not configured");
    expect(html).toContain("Resolve review readiness blockers");
    expect(html).not.toContain("No action is waiting");
  });
  it("routes a ready simulation to commercial sign-off without payment authority", async () => {
    state.ready = true;
    const html = await render();
    expect(html).toContain("Sign off the validated review");
    expect(html).toContain("Nothing is paid by review sign-off");
    expect(html).not.toContain("/settlement?run=run-1");
  });
  it("keeps an unknown manual handoff open and distinguishes accepted evidence from settlement", async () => {
    state.ready = true; state.signed = true; state.exported = true; state.outcome = "UNKNOWN";
    expect(await render()).toContain("Investigate the open handoff");
    state.outcome = "MANUAL_ACCEPTED";
    const html = await render();
    expect(html).toContain("Accepted manually — payment settlement is separate");
    expect(html).not.toContain("Investigate the open handoff");
  });
  it("does not read reviewer evidence for a viewer and makes read failures explicit", async () => {
    state.denied = true;
    expect(await render()).not.toContain("Company cutoff is not configured");
    expect(state.reads).toBe(0);
    state.denied = false; state.failed = true;
    expect(await render()).toContain("Review readiness could not be loaded");
  });
});


it("renders an unavailable period instead of crashing or showing first-run/zero evidence", async () => {
  Object.assign(state, { periodFailed: true, activityFailed: false, failed: false });
  const html = await render();
  expect(html).toContain("Period details unavailable");
  expect(html).toContain("No counts, totals or payment readiness can be inferred");
  expect(html).not.toContain("Your first payroll period");
  expect(html).not.toContain("125.00");
  expect(html).not.toContain("PRIVATE_DRIVER_DETAIL");
});
it("renders an audit-unavailable alert while retaining separately loaded period facts", async () => {
  Object.assign(state, { periodFailed: false, activityFailed: true, failed: false });
  const html = await render();
  expect(html).toContain("Activity unavailable");
  expect(html).toContain("125.00");
  expect(html).not.toContain("Period details unavailable");
});
