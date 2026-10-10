import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunPage from "@/app/(app)/(workspace)/runs/[runId]/page";

const runId = "c3b64b32-7f23-4a64-8993-9b4ef2151c63";
const lineId = "00000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ financial: true, paymentOnly: false, reviewFailure: false, reviewReads: 0, calculationId: "calculation-1" as string | null }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", roles: [state.financial ? state.paymentOnly ? "PAYMENT_APPROVER" : "HR_APPROVER" : "VIEWER"] }, client: {} }) }));
vi.mock("@/server/db/reviewer-workspace", () => ({ reviewerWorkspace: async () => { state.reviewReads++; if (state.reviewFailure) throw new Error("synthetic evidence read failure"); return { review: { revision: 0, calculationId: state.calculationId }, settings: null, selectedBaselineId: null }; } }));
vi.mock("@/components/payroll-review-panel", () => ({ PayrollReviewPanel: () => "Commercial review workspace" }));
vi.mock("@/server/db/table-views", () => ({ initialTable: async () => null }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn() }));
vi.mock("@/server/db/calculate", () => ({ loadRunAdjustments: vi.fn() }));
vi.mock("@/components/run-actions", () => ({ ApproveRunForm: () => null, CalculateButton: () => null, ResumeObligationsButton: () => null, SubmitForApprovalButton: () => null }));
vi.mock("@/components/worker-forms", () => ({ RunAdjustmentsForm: () => null }));
vi.mock("@/components/table-view", () => ({ TableView: () => null }));
vi.mock("@/server/db/views", () => ({ runView: async () => ({
  financial: state.financial,
  run: { id: "c3b64b32-7f23-4a64-8993-9b4ef2151c63", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 4, mode: "SIMULATION", status: "CALCULATION_VALIDATED" },
  calculationHash: "a".repeat(64), netTotal: "125.00", obligations: [], variance: null,
  lines: [{ id: "00000000-0000-4000-8000-000000000001", worker: "K-001", gross: "125.00", deductions: "0.00", net: "125.00", trace: [{ step: 1, component: "BASE", rule: "HOURLY_BASE", ruleVersion: 4, source: "approved-work-record", inputs: { hours: "5", rate: "25", evidence: "<script>unsafe</script>" }, amount: "125.00" }] }],
}) }));

describe("run trace presentation", () => {
  beforeEach(() => { state.financial = true; state.paymentOnly = false; state.reviewFailure = false; state.reviewReads = 0; state.calculationId = "calculation-1"; });
  it("offers task controls only to payroll reviewers and links the workflow view", async () => {
    const reviewer = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(reviewer).toContain('id="review-tasks-heading"');
    expect(reviewer).toContain(`/runs/${runId}/workflow`);
    state.paymentOnly = true;
    const payment = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(payment).not.toContain('id="review-tasks-heading"');
  });
  it("links a stable calculation-line target and exposes exact source/inputs safely", async () => {
    const html = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(`id="trace-${lineId}"`);
    expect(html).toContain('id="calculation-trace"');
    expect(html).toContain('aria-label="Calculation trace for K-001"');
    expect(html).toContain("approved-work-record");
    expect(html).toContain("HOURLY_BASE v4");
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>unsafe</script>");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("Simulation complete");
    expect(html).not.toContain(`/settlement?run=${runId}`);
    expect(html).toContain("Commercial review workspace");
  });
  it("shows denied financial access without implying unavailable confidential amounts are zero", async () => {
    state.financial = false;
    const html = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Your role cannot inspect calculation amounts or review evidence");
    expect(html).not.toContain("125.00");
    expect(html).not.toContain("No obligations for this run");
    expect(html).not.toContain("Not calculated yet");
    expect(state.reviewReads).toBe(0);
  });
  it("keeps failed evidence reads explicit and withholds commercial review actions", async () => {
    state.reviewFailure = true;
    const html = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Review workspace unavailable");
    expect(html).toContain("Readiness and review evidence could not be loaded");
    expect(html).not.toContain("Commercial review workspace");
  });
  it("resets the panel only when its authoritative calculation identity changes", async () => {
    const key = (node: ReactNode): string | null => {
      if (!isValidElement<{ children?: ReactNode; runId?: string }>(node)) return null;
      if (node.props.runId && String(node.key).includes("none")) return String(node.key);
      for (const child of Children.toArray(node.props.children)) { const found = key(child); if (found) return found; }
      return null;
    };
    state.calculationId = null;
    const before = key(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    state.calculationId = "calculation-1";
    const after = key(await RunPage({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }));
    expect(before).toContain("uncalculated");
    expect(after).toContain("calculation-1");
    expect(after).not.toBe(before);
  });
});
