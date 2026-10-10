import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), workers: vi.fn(), history: vi.fn(), table: vi.fn(), log: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: string }) => createElement("a", { href }, children) }));
vi.mock("@/server/auth/page-session", () => ({ pageSession: mocks.session }));
vi.mock("@/server/db/workers", () => ({ listWorkers: mocks.workers }));
vi.mock("@/server/db/views", () => ({ workerHistoryView: mocks.history }));
vi.mock("@/server/db/table-views", () => ({ initialTable: mocks.table }));
vi.mock("@/server/log", () => ({ logError: mocks.log }));
vi.mock("@/components/shell/page-header", () => ({ PageHeader: ({ title }: { title: string }) => createElement("h1", null, title) }));
vi.mock("@/components/table-view", () => ({ TableView: () => "directory-table" }));
vi.mock("@/components/worker-forms", () => ({ AddWorkerForm: () => "add-worker-action", WorkerRow: () => createElement("tbody", null, createElement("tr", null, createElement("td", null, "edit-recipient-actions"))) }));
vi.mock("@/components/local-name-unlock", () => ({ LocalNameUnlock: () => "local-name-directory" }));
vi.mock("@/components/resource-column-form", () => ({ ResourceColumnForm: () => "resource-action" }));
vi.mock("@/components/worker-history", () => ({ WorkerHistoryPanel: () => "selected-worker-history" }));
import WorkersPage from "@/app/(app)/(workspace)/workers/page";
const workerId = "10000000-0000-4000-8000-000000000001";
const worker = { id: workerId, pseudonym: "W001", payType: "SALARIED", compensation: { baseAmount: 1000000000n, hourlyRate: 0n }, walletAddress: null, walletConfirmed: false, active: true, leftOn: null, leftReason: null, history: [], metadata: {} };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ actor: { companyId: "company", userId: "user", roles: ["HR_APPROVER", "PAYMENT_APPROVER"] }, client: {} });
  mocks.workers.mockResolvedValue([worker]); mocks.history.mockResolvedValue({ workerId });
  mocks.table.mockResolvedValue({ initial: { rows: [{ code: "W001" }], rowIds: [workerId] } });
});
const render = async (selected?: string) => renderToStaticMarkup(await WorkersPage({ searchParams: Promise.resolve(selected ? { worker: selected } : {}) }));
const unavailable = (html: string) => {
  expect(html).toContain("Workers unavailable"); expect(html).toContain('role="alert"'); expect(html).toContain("Reload"); expect(html).toMatch(/support code/i);
  for (const hidden of ["No active workers", "No workers yet", "add-worker-action", "edit-recipient-actions", "resource-action", "local-name-directory", "directory-table", "selected-worker-history", "PRIVATE-DATABASE-VALUE", "42703"]) expect(html).not.toContain(hidden);
};
it.each(["workers", "history", "table"] as const)("renders unavailable and suppresses all dependent surfaces when %s fails", async source => {
  mocks[source].mockRejectedValue(new Error("db workers read failed (42703) PRIVATE-DATABASE-VALUE"));
  unavailable(await render(source === "history" ? workerId : undefined));
  expect(mocks.log).toHaveBeenCalledTimes(1);
});
it("does not call financial loaders for a directory-only role and keeps directory failure explicit", async () => {
  mocks.session.mockResolvedValue({ actor: { companyId: "company", userId: "user", roles: ["VIEWER"] }, client: {} });
  mocks.table.mockRejectedValue(new Error("directory unavailable"));
  unavailable(await render()); expect(mocks.workers).not.toHaveBeenCalled();
});
it("preserves successful worker actions and selected history", async () => {
  const html = await render(workerId);
  for (const shown of ["add-worker-action", "edit-recipient-actions", "resource-action", "local-name-directory", "directory-table", "selected-worker-history"]) expect(html).toContain(shown);
  expect(html).not.toContain("Workers unavailable"); expect(mocks.log).not.toHaveBeenCalled();
});
it("shows a genuine empty worker directory after successful reads", async () => {
  mocks.workers.mockResolvedValue([]); mocks.table.mockResolvedValue({ initial: { rows: [], rowIds: [] } });
  const html = await render(); expect(html).toContain("No active workers"); expect(html).toContain("add-worker-action"); expect(html).not.toContain("Workers unavailable");
});
it("keeps authentication errors outside the unavailable handler", async () => {
  mocks.session.mockRejectedValue(new Error("AUTH_REDIRECT"));
  await expect(render()).rejects.toThrow("AUTH_REDIRECT"); expect(mocks.workers).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
});
it.each(["invalid", workerId])("keeps a genuinely absent or invalid selected worker as 404: %s", async selected => {
  mocks.history.mockResolvedValue(null);
  await expect(render(selected)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404"); expect(mocks.log).not.toHaveBeenCalled();
});
