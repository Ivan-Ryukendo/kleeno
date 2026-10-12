import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ImportPage from "@/app/(app)/(workspace)/import/page";
import SettlementPage from "@/app/(app)/(workspace)/settlement/page";

const runId = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ selected: true, status: "DRAFT", canPay: false, live: false, approvedByYou: false, eq: vi.fn() }));
vi.mock("@/server/db/client", () => ({ must: (read: { data: unknown; error: unknown }) => { if (read.error) throw new Error("read failed"); return read.data; } }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh() {} }) }));
vi.mock("@/components/import-wizard", () => ({ ImportWizard: ({ runs }: { runs: { id: string }[] }) => `Wizard for ${runs.map(r => r.id).join(",")}` }));
vi.mock("@/components/payroll/frame-data", () => ({ loadFrameData: async () => ({ facts: { workers: null, autoMatched: null, openExceptions: null }, runs: [] }) }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", userId: "actor", roles: state.canPay ? ["PAYMENT_APPROVER"] : ["HR_APPROVER"] }, client: { from: (table: string) => {
  const rows = table === "payroll_runs" ? [{ id: "10000000-0000-4000-8000-000000000001", mode: "SIMULATION", status: state.status, period_start: "2026-10-01", period_end: "2026-10-31" }] : [];
  const q = { select: () => q, eq: (...args: unknown[]) => { state.eq(...args); return q; }, in: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: state.selected ? rows[0] : null, error: null }), then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }) }; return q;
} } }) }));
vi.mock("@/server/db/standing", () => ({ listStanding: async () => [] }));
vi.mock("@/server/db/settlement", () => ({ settlementView: async () => ({ company: { live_payments_enabled: state.live, live_status: "PROVISIONED", is_demo: false, is_sandbox: false, per_payment_ceiling: "100.00", guard_address: null }, approver: null, balance: null, runs: [{ id: "10000000-0000-4000-8000-000000000001", status: "OBLIGATIONS_CREATED", period_start: "2026-10-01", period_end: "2026-10-31" }], run: { id: "10000000-0000-4000-8000-000000000001", period: "2026-10-01 to 2026-10-31", status: "OBLIGATIONS_CREATED", total: "20.00", obligations: [], batch: { id: "batch", status: "PROPOSED", planHash: "a".repeat(64), total: "20.00", count: 1, held: 0, source: "DETERMINISTIC", authorizedBy: null }, runSignals: [], payrollApprovedByYou: state.approvedByYou } }) }));

beforeEach(() => { state.selected = true; state.status = "DRAFT"; state.canPay = false; state.live = false; state.approvedByYou = false; state.eq.mockClear(); });
const html = (node: Awaited<ReturnType<typeof ImportPage>>) => renderToStaticMarkup(node);
it("puts the selected import in Payroll and binds the wizard to that exact run", async () => {
  const output = html(await ImportPage({ searchParams: Promise.resolve({ run: runId }) }));
  expect(output).toContain("Run views"); expect(output).toContain("Payroll</h1>"); expect(output).toContain(`Wizard for ${runId}`);
  expect(state.eq).toHaveBeenCalledWith("company_id", "company"); expect(state.eq).toHaveBeenCalledWith("id", runId);
});
it("keeps a closed selected import visible but cannot silently import into a different run", async () => {
  state.status = "CALCULATION_VALIDATED";
  const output = html(await ImportPage({ searchParams: Promise.resolve({ run: runId }) }));
  expect(output).toContain("closed for imports"); expect(output).not.toContain("Wizard for");
});
it("rejects invalid and absent selected import runs", async () => {
  await expect(ImportPage({ searchParams: Promise.resolve({ run: "bad" }) })).rejects.toThrow("NOT_FOUND");
  state.selected = false; await expect(ImportPage({ searchParams: Promise.resolve({ run: runId }) })).rejects.toThrow("NOT_FOUND");
});
it("retains company import with no selected run", async () => {
  const output = html(await ImportPage({ searchParams: Promise.resolve({}) })); expect(output).toContain("Recent imports"); expect(output).toContain("Wizard for");
});
it("puts live settlement in Payroll without granting HR a signing action", async () => {
  const output = html(await SettlementPage({ searchParams: Promise.resolve({ run: runId }) }));
  expect(output).toContain("Payroll</h1>"); expect(output).toContain("Payment approvers only"); expect(output).toContain("A payment approver reviews"); expect(output).not.toContain("Sign this exact plan");
});
it.each(["off", "same-person"])("preserves the %s signing refusal", async kind => {
  state.canPay = true; state.live = kind !== "off"; state.approvedByYou = kind === "same-person";
  const output = html(await SettlementPage({ searchParams: Promise.resolve({ run: runId }) }));
  expect(output).toContain(kind === "off" ? "Live payments are OFF" : "different payment approver"); expect(output).not.toContain("Sign this exact plan");
});

it("does not show another run's payment evidence for an unavailable selected run", async () => {
  const missing = "10000000-0000-4000-8000-000000000099";
  const output = html(await SettlementPage({ searchParams: Promise.resolve({ run: missing }) }));
  expect(output).toContain("Payments unavailable for this run"); expect(output).toContain(`/runs/${missing}`); expect(output).not.toContain("20.00"); expect(output).not.toContain("Plan and sign");
});
