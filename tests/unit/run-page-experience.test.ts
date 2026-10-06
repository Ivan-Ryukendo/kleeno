import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RunPage from "@/app/(app)/(workspace)/runs/[runId]/page";

const runId = "c3b64b32-7f23-4a64-8993-9b4ef2151c63";
const lineId = "00000000-0000-4000-8000-000000000001";
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", roles: ["HR_APPROVER"] }, client: {} }) }));
vi.mock("@/server/db/table-views", () => ({ initialTable: async () => null }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn() }));
vi.mock("@/server/db/calculate", () => ({ loadRunAdjustments: vi.fn() }));
vi.mock("@/components/run-actions", () => ({ ApproveRunForm: () => null, CalculateButton: () => null, ResumeObligationsButton: () => null, SubmitForApprovalButton: () => null }));
vi.mock("@/components/worker-forms", () => ({ RunAdjustmentsForm: () => null }));
vi.mock("@/components/table-view", () => ({ TableView: () => null }));
vi.mock("@/server/db/views", () => ({ runView: async () => ({
  run: { id: "c3b64b32-7f23-4a64-8993-9b4ef2151c63", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 4, mode: "SIMULATION", status: "CALCULATION_VALIDATED" },
  calculationHash: "a".repeat(64), netTotal: "125.00", obligations: [], variance: null,
  lines: [{ id: "00000000-0000-4000-8000-000000000001", worker: "K-001", gross: "125.00", deductions: "0.00", net: "125.00", trace: [{ step: 1, component: "BASE", rule: "HOURLY_BASE", ruleVersion: 4, source: "approved-work-record", inputs: { hours: "5", rate: "25", evidence: "<script>unsafe</script>" }, amount: "125.00" }] }],
}) }));

describe("run trace presentation", () => {
  it("links a stable calculation-line target and exposes exact source/inputs safely", async () => {
    const html = renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId }) }));
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
  });
});
