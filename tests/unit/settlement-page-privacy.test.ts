import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ roles: ["OWNER"] as string[], select: vi.fn(), from: vi.fn(), settlement: vi.fn(), standing: vi.fn(), live: true }));
vi.mock("@/components/payroll/frame-data", () => ({ loadFrameData: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: async () => ({ actor: { companyId: "company", userId: "actor", roles: state.roles }, client: { from: state.from } }) }));
vi.mock("@/server/db/settlement", () => ({ settlementView: state.settlement }));
vi.mock("@/server/db/standing", () => ({ listStanding: state.standing }));
import SettlementPage from "@/app/(app)/(workspace)/settlement/page";

beforeEach(() => {
  vi.clearAllMocks(); state.roles = ["OWNER"]; state.live = true;
  state.from.mockImplementation(() => { const q = { select: state.select.mockImplementation(() => q), eq: () => q, single: async () => ({ data: { live_status: "PROVISIONED", live_payments_enabled: state.live, is_demo: false, is_sandbox: false, per_payment_ceiling: "PRIVATE-CEILING", guard_address: "PRIVATE-GUARD" }, error: null }) }; return q; });
  state.settlement.mockResolvedValue({ company: { live_status: "NOT_REQUESTED", live_payments_enabled: false, is_demo: true, is_sandbox: false, per_payment_ceiling: "0.00", guard_address: null }, run: null, runs: [], approver: null, balance: null });
});
const render = async () => renderToStaticMarkup(await SettlementPage({ searchParams: Promise.resolve({}) }));
it("preserves owner OFF control with only safe status projection and denies financial amounts explicitly", async () => {
  const html = await render();
  expect(html).toContain("Financial access required"); expect(html).toContain("Switch live payments OFF");
  expect(state.from).toHaveBeenCalledWith("companies");
  expect(state.select).toHaveBeenCalledWith("live_status, live_payments_enabled, is_demo, is_sandbox");
  expect(state.settlement).not.toHaveBeenCalled(); expect(state.standing).not.toHaveBeenCalled();
  for (const value of ["PRIVATE-CEILING", "PRIVATE-GUARD", "Approver wallet", "Nothing to pay yet", "Top up the approver wallet"]) expect(html).not.toContain(value);
});
it("keeps existing owner reauth enable flow while VIEWER gets a denial without any company/financial load", async () => {
  state.live = false; const owner = await render(); expect(owner).toContain("Your password"); expect(owner).toContain("Authenticator code");
  state.roles = ["VIEWER"]; state.from.mockClear(); const viewer = await render();
  expect(viewer).toContain("Financial access required"); expect(viewer).not.toContain("Switch live payments"); expect(state.from).not.toHaveBeenCalled(); expect(state.settlement).not.toHaveBeenCalled();
});
it("passes current financial roles to the shared reader and keeps genuine empty payment state distinct", async () => {
  state.roles = ["HR_APPROVER"]; const html = await render();
  expect(state.settlement).toHaveBeenCalledWith(expect.anything(), "company", "actor", undefined, ["HR_APPROVER"]);
  expect(html).toContain("Nothing to pay yet"); expect(html).not.toContain("Financial access required"); expect(state.standing).not.toHaveBeenCalled();
});
it("reports unavailable owner metadata without substituting a financial load or claiming there are no payments", async () => {
  const q = { select: () => q, eq: () => q, single: async () => ({ data: null, error: { code: "unavailable" } }) }; state.from.mockReturnValue(q);
  const html = await render();
  expect(html).toContain("Live-payment controls could not be loaded"); expect(html).toContain('role="alert"');
  expect(html).not.toContain("Nothing to pay yet"); expect(state.settlement).not.toHaveBeenCalled(); expect(state.standing).not.toHaveBeenCalled();
});
