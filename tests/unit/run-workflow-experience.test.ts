import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import RunWorkflowPage from "@/app/(app)/(workspace)/runs/[runId]/workflow/page";

const id = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ financial: true, exists: true, periodFailure: false, reviewFailure: false, companyFailure: false, acknowledgement: "UNKNOWN", mode: "SIMULATION", rolesOverride: null as string[] | null, reviewReads: 0, runView: vi.fn(), steps: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company-1", userId: "actor-1", roles: state.rolesOverride ?? [state.financial ? "HR_APPROVER" : "VIEWER"] }, client: { from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { name: "Synthetic workspace", live_payments_enabled: false }, error: state.companyFailure ? { code: "failed" } : null }) }; return query; } } }) }));
vi.mock("@/server/db/views", () => ({
  runView: async (...args: unknown[]) => { state.runView(...args); return state.exists ? { financial: state.financial, run: { id: "10000000-0000-4000-8000-000000000001", mode: state.mode, status: "CALCULATION_VALIDATED", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 2 }, calculationHash: "a".repeat(64), lines: [{ id: "line-1" }] } : null; },
  periodView: async () => { if (state.periodFailure) throw new Error("private database failure"); return { workers: null, autoMatched: null, openExceptions: 1, settled: null, obligations: null }; },
  periodSteps: (...args: unknown[]) => { state.steps(...args); return ["Policy", "Import", "Exceptions", "Calculation", "Approval", "Settlement"].map((label, index) => ({ label, state: index === 2 ? "blocked" : index >= 4 && state.mode === "SIMULATION" ? "unavailable" : "done", detail: index >= 4 && state.mode === "SIMULATION" ? "Simulation cannot pay" : "" })); },
}));
vi.mock("@/server/db/review-readiness", () => ({ reviewReadiness: async () => { state.reviewReads++; if (state.reviewFailure) throw new Error("private evidence failed"); return { readiness: { ready: false, received: 0, expected: 1, cutoff: null, blockers: ["Company cutoff requires configuration"], items: [{ id: "TIMESHEETS", label: "Timesheet import", status: "MISSING", ref: null, reason: "Not received" }] } }; } }));
vi.mock("@/server/db/payroll-review", () => ({ loadPayrollReview: async () => ({ revision: 3, calculationId: "calc-1", calculationHash: "a".repeat(64), signoff: { id: "signoff-1", actor: "actor-1", at: "2026-10-07T12:00:00Z" }, export: { id: "export-1", formatVersion: 1, byteHash: "b".repeat(64), at: "2026-10-07T12:00:00Z" }, acknowledgement: { status: state.acknowledgement, reference: "<script>PRIVATE-manual-evidence</script>", at: "2026-10-07T12:00:00Z" } }) }));
const page = async (runId = id) => renderToStaticMarkup(await RunWorkflowPage({ params: Promise.resolve({ runId }) }));
beforeEach(() => { state.financial = true; state.exists = true; state.periodFailure = false; state.reviewFailure = false; state.companyFailure = false; state.acknowledgement = "UNKNOWN"; state.mode = "SIMULATION"; state.rolesOverride = null; state.reviewReads = 0; state.runView.mockClear(); state.steps.mockClear(); });

it.each(["SIMULATION", "LIVE_TESTNET"].flatMap(mode => [["VIEWER"], ["OWNER"], ["HR_APPROVER"], ["PAYROLL_APPROVER"], ["PAYMENT_APPROVER"], ["OWNER", "HR_APPROVER"], ["OWNER", "PAYMENT_APPROVER"]].map(roles => ({ mode, roles }))))("keeps workflow payment navigation role/mode gated: $mode $roles", async ({ mode, roles }) => {
  state.mode = mode; state.rolesOverride = roles;
  const navigation = (await page()).match(/<nav aria-label="Run views"[\s\S]*?<\/nav>/)?.[0];
  expect(navigation).toBeDefined();
  expect(navigation?.includes(`/settlement?run=${id}`)).toBe(mode !== "SIMULATION" && roles.includes("PAYMENT_APPROVER"));
  expect(navigation?.match(/aria-current="page"/g)).toHaveLength(1);
});

it("shows connected semantic native disclosures and separates simulation from human handoff authority", async () => {
  const html = await page();
  const navigation = html.match(/<nav aria-label="Run views"[\s\S]*?<\/nav>/)?.[0];
  const currentLink = navigation?.match(/<a\b[^>]*>/g)?.find(link => link.includes(`href="/runs/${id}/workflow"`));
  expect(currentLink).toContain('aria-current="page"');
  expect(navigation?.match(/aria-current="page"/g)).toHaveLength(1);
  expect(navigation).toContain(`href="/runs/${id}"`);
  expect(html).toContain('aria-label="Recorded payroll workflow steps"');
  expect(html).toContain('aria-label="Recorded review and handoff steps"');
  expect(html.match(/<details/g)).toHaveLength(10);
  expect(html).toContain("Synthetic workspace"); expect(html).toContain("2026-10-01"); expect(html).toContain("Company ID");
  expect(html).toContain("Worker coverage is unavailable; it is not zero");
  expect(html).toContain("Simulation cannot create obligations or pay");
  expect(html).not.toContain(`/settlement?run=${id}`);
  expect(html).toContain("Manual outcome unknown; still needs review");
  expect(html).toContain("Company cutoff requires configuration");
  expect(html).toContain("&lt;script&gt;PRIVATE-manual-evidence&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain(`href="/runs/${id}#calculation-trace"`);
  expect(html).toContain(`href="/runs/${id}#review-tasks-heading"`);
  expect(html).not.toContain("<form"); expect(html).not.toContain("<button");
  expect(state.runView.mock.calls[0].slice(1)).toEqual(["company-1", id, ["HR_APPROVER"]]);
  expect(state.steps).toHaveBeenCalledWith("CALCULATION_VALIDATED", "SIMULATION", 1, false);
});

it("denies private evidence without private reads or zero-value substitutes", async () => {
  state.financial = false;
  const html = await page();
  expect(html).toContain("Your role cannot inspect private review evidence");
  expect(html).not.toContain("PRIVATE-manual-evidence"); expect(html).not.toContain("a".repeat(64));
  expect(html).not.toContain("/review?download=1"); expect(html).not.toContain("#review-tasks-heading");
  expect(state.reviewReads).toBe(0);
  expect(state.runView.mock.calls[0].slice(1)).toEqual(["company-1", id, ["VIEWER"]]);
});

it("reports rejected manual handoff and failed private evidence explicitly", async () => {
  state.acknowledgement = "MANUAL_REJECTED";
  expect(await page()).toContain("Manual acknowledgement rejected; still needs review");
  state.reviewFailure = true;
  const html = await page();
  expect(html).toContain("Review evidence unavailable"); expect(html).not.toContain("PRIVATE-manual-evidence");
  expect(html).not.toContain('aria-label="Recorded review and handoff steps"');
});

it("never invents stage counts after a failed company or period read", async () => {
  state.companyFailure = true;
  expect(await page()).toContain("Run workflow unavailable");
  state.companyFailure = false; state.periodFailure = true;
  const html = await page(); expect(html).toContain("Run workflow unavailable");
  expect(html).not.toContain("private database failure"); expect(html).not.toContain("Recorded payroll workflow steps");
});

it("returns not found for malformed or absent run IDs", async () => {
  await expect(page("invalid")).rejects.toThrow("NOT_FOUND");
  expect(state.runView).not.toHaveBeenCalled();
  state.exists = false;
  await expect(page()).rejects.toThrow("NOT_FOUND");
});
