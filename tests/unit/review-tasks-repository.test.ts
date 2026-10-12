import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ membership: { data: { roles: ["PAYROLL_APPROVER"], removed_at: null }, error: null } as { data: unknown; error: unknown }, rows: new Map<string, { data: unknown[]; error: unknown; count: number | null }>(), filters: [] as unknown[][], rpc: vi.fn(), seal: vi.fn(), open: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mock.rpc }), must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data == null) throw new Error("unavailable"); return result.data; } }));
vi.mock("@/server/crypto", () => ({ fingerprint: async () => "a".repeat(64), sealJson: mock.seal, openJson: mock.open }));
vi.mock("@/server/db/review-readiness", () => ({ reviewReadiness: async () => ({ readiness: { items: [{ id: "TIMESHEETS", status: "MISSING" }, { id: "LEAVE", status: "RECEIVED" }] } }) }));

import { loadReviewTasks, reviewTaskAction } from "@/server/db/review-tasks";
const id = "10000000-0000-4000-8000-000000000001";
const who = { companyId: id, userId: id, roles: ["PAYROLL_APPROVER"] as const, correlationId: id };
const reader = { from(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "range"]) query[method] = (...args: unknown[]) => { mock.filters.push([table, method, ...args]); return query; };
  query.maybeSingle = async () => table === "memberships" ? mock.membership : { data: { id }, error: null };
  query.then = (resolve: (value: unknown) => unknown, reject: (value: unknown) => unknown) => Promise.resolve(mock.rows.get(table)).then(resolve, reject);
  return query;
} };
const command = { action: "create" as const, taskId: id, expectedRevision: 0 as const, idempotencyKey: id, source: { kind: "MISSING_EVIDENCE" as const, importType: "TIMESHEETS" as const }, assigneeId: id, dueAt: "2026-10-08T12:00:00Z", severity: "HIGH" as const, status: "OPEN" as const, nextAction: "PRIVATE-request", evidenceRefs: ["PRIVATE-ref"] };
beforeEach(() => {
  mock.filters.length = 0; mock.rows.clear(); mock.rpc.mockReset(); mock.seal.mockReset(); mock.open.mockReset();
  mock.membership = { data: { roles: ["PAYROLL_APPROVER"], removed_at: null }, error: null };
  mock.rows.set("memberships", { data: [{ user_id: id, roles: ["PAYROLL_APPROVER"] }, { user_id: "viewer", roles: ["VIEWER"] }], error: null, count: 2 });
  mock.rows.set("review_task_events", { data: [], error: null, count: 0 });
  mock.rows.set("exceptions", { data: [{ id: "exception" }], error: null, count: 1 });
  mock.rpc.mockResolvedValue({ data: { code: "OK", id }, error: null }); mock.seal.mockResolvedValue("encrypted");
});

it("fails closed before decryption for missing or revoked reviewer permissions", async () => {
  for (const roles of [[], ["OWNER"], ["VIEWER"], ["PAYMENT_APPROVER"]]) {
    await expect(loadReviewTasks(reader as never, { ...who, roles: roles as never }, id)).rejects.toThrow("Only HR");
  }
  for (const data of [null, { roles: ["OWNER"], removed_at: null }, { roles: ["PAYROLL_APPROVER"], removed_at: "2026-10-07T00:00:00Z" }]) {
    mock.membership.data = data;
    await expect(loadReviewTasks(reader as never, who, id)).rejects.toThrow("Current membership");
  }
  expect(mock.open).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
});

it("returns only eligible safe ownership IDs and grounded missing-input/exception sources", async () => {
  const view = await loadReviewTasks(reader as never, who, id);
  expect(view).toEqual({ tasks: [], assignees: [{ id, roles: ["PAYROLL_APPROVER"] }], sources: [{ kind: "EXCEPTION", exceptionId: "exception" }, { kind: "MISSING_EVIDENCE", importType: "TIMESHEETS" }] });
  expect(mock.filters.filter(([, method, field]) => method === "eq" && field === "company_id").every(([, , , value]) => value === who.companyId)).toBe(true);
});

it.each(["memberships", "review_task_events", "exceptions"])("rejects truncated %s instead of returning a complete-looking queue", async table => {
  mock.rows.get(table)!.count! += 1;
  await expect(loadReviewTasks(reader as never, who, id)).rejects.toThrow("incomplete");
});

it("encrypts deliberate action/evidence and delegates one strict command to atomic append", async () => {
  await reviewTaskAction(reader as never, who, id, command);
  expect(mock.seal).toHaveBeenCalledWith(id, "review_task_events", "payload_enc", id, { nextAction: "PRIVATE-request", evidenceRefs: ["PRIVATE-ref"] });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  const [functionName, input] = mock.rpc.mock.calls[0];
  expect(functionName).toBe("append_review_task");
  expect(input).toMatchObject({ p_company: who.companyId, p_run: id, p_actor: who.userId, p_event: { task_id: id, expected_revision: 0, idempotency_key: id, payload_enc: "encrypted", source_kind: "MISSING_EVIDENCE", import_type: "TIMESHEETS" } });
  expect(JSON.stringify(input)).not.toContain("PRIVATE-");
});

it.each(["FORBIDDEN", "ASSIGNEE_UNAVAILABLE", "SOURCE_UNAVAILABLE", "CONFLICT"])("surfaces %s without masking stale commands as successful work", async code => {
  mock.rpc.mockResolvedValue({ data: { code }, error: null });
  await expect(reviewTaskAction(reader as never, who, id, command)).rejects.toThrow();
});
