import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import RunPage from "@/app/(app)/(workspace)/runs/[runId]/page";
import type { Role } from "@/core/tenancy";

const id = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ mode: "SIMULATION", roles: ["VIEWER"] as Role[] }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", roles: state.roles }, client: {} }) }));
vi.mock("@/server/db/views", () => ({ runView: async () => ({ financial: false, run: { id, mode: state.mode, status: "CALCULATION_VALIDATED", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 1 }, lines: [], obligations: [], calculationHash: null, netTotal: null, variance: null }) }));
vi.mock("@/server/db/table-views", () => ({ initialTable: async () => null }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn() }));
vi.mock("@/server/db/calculate", () => ({ loadRunAdjustments: vi.fn() }));
vi.mock("@/server/db/reviewer-workspace", () => ({ reviewerWorkspace: vi.fn() }));
vi.mock("@/components/run-actions", () => ({ ApproveRunForm: () => null, CalculateButton: () => null, ResumeObligationsButton: () => null, SubmitForApprovalButton: () => null }));
vi.mock("@/components/worker-forms", () => ({ RunAdjustmentsForm: () => null }));
vi.mock("@/components/table-view", () => ({ TableView: () => null }));
vi.mock("@/components/payroll-review-panel", () => ({ PayrollReviewPanel: () => null }));
const page = async () => renderToStaticMarkup(await RunPage({ params: Promise.resolve({ runId: id }), searchParams: Promise.resolve({}) }));
const navigation = (html: string) => html.match(/<nav aria-label="Run views"[\s\S]*?<\/nav>/)?.[0];
beforeEach(() => { state.mode = "SIMULATION"; state.roles = ["VIEWER"]; });

it("shows semantic same-run links with only Table current on the run page", async () => {
  const nav = navigation(await page());
  expect(nav).toBeDefined();
  const currentLink = nav?.match(/<a\b[^>]*>/g)?.find(link => link.includes(`href="/runs/${id}"`));
  expect(currentLink).toContain('aria-current="page"');
  expect(nav).toContain(`href="/runs/${id}/workflow"`);
  expect(nav).toContain(`href="/audit?run=${id}"`);
  expect(nav?.match(/aria-current="page"/g)).toHaveLength(1);
  expect(nav).not.toContain('role="tab');
});

const memberships: Role[][] = [["VIEWER"], ["OWNER"], ["HR_APPROVER"], ["PAYROLL_APPROVER"], ["PAYMENT_APPROVER"], ["OWNER", "HR_APPROVER"], ["OWNER", "PAYMENT_APPROVER"]];
it.each(["SIMULATION", "LIVE_TESTNET"].flatMap(mode => memberships.map(roles => ({ mode, roles }))))("keeps payment discovery within mode/role authority: $mode $roles", async ({ mode, roles }) => {
  state.mode = mode; state.roles = roles;
  const nav = navigation(await page());
  expect(nav).toBeDefined();
  expect(nav?.includes(`/settlement?run=${id}`)).toBe(mode !== "SIMULATION" && roles.includes("PAYMENT_APPROVER"));
});
