import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), seal: vi.fn(), open: vi.fn(), fingerprint: vi.fn(), resources: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => calls, must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("scoped database read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ sealJson: calls.seal, openJson: calls.open, fingerprint: calls.fingerprint }));
vi.mock("@/server/db/resources", () => ({ resourceColumns: calls.resources, resourceColumnDef: (value: unknown) => value }));
import { CreateNamedViewSchema, NamedViewCommandSchema, validateNamedView } from "@/core/named-views";
import { defaultView } from "@/core/views";
import { createNamedView, listNamedViews, loadNamedView, namedViewAction } from "@/server/db/named-views";
const COMPANY = "11111111-1111-4111-8111-111111111111", USER = "22222222-2222-4222-8222-222222222222", ID = "33333333-3333-4333-8333-333333333333", KEY = "44444444-4444-4444-8444-444444444444";
const actor = { companyId: COMPANY, userId: USER, roles: ["HR_APPROVER"] as const, correlationId: KEY };
const create = () => ({ action: "create" as const, scope: "PERSONAL" as const, name: "Private name canary", view: defaultView("workers", ["HR_APPROVER"]), idempotencyKey: KEY });
let roles: string[], head: { id: string; company_id: string; table_id: string; scope: string; owner_id: string; revision: number; archived: boolean; created_at: string; updated_at: string };
let payload: unknown, count: number, revokeDuringVersion: boolean;
const reads: { table: string; company: string | null; ownerFilter: string | null }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); roles = ["HR_APPROVER"]; count = 1; revokeDuringVersion = false; reads.length = 0;
  head = { id: ID, company_id: COMPANY, table_id: "workers", scope: "PERSONAL", owner_id: USER, revision: 1, archived: false, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" };
  payload = { name: create().name, view: create().view };
  calls.open.mockImplementation(async () => payload); calls.seal.mockResolvedValue("sealed-name-filter-layout"); calls.fingerprint.mockResolvedValue("a".repeat(64)); calls.resources.mockResolvedValue([]); calls.rpc.mockResolvedValue({ data: { code: "OK", id: ID, revision: 1 }, error: null });
  calls.from.mockImplementation((table: string) => {
    const read = { table, company: null as string | null, ownerFilter: null as string | null }; reads.push(read); let single = false;
    const q = { select() { return q; }, eq(key: string, value: unknown) { if (key === "company_id") read.company = String(value); return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, or(value: string) { read.ownerFilter = value; return q; }, maybeSingle() { single = true; return q; },
      then(resolve: (v: unknown) => unknown) { const values = table === "memberships" ? roles.length ? [{ roles }] : [] : table === "named_table_views" ? [head] : [{ id: KEY, company_id: COMPANY, view_id: ID, revision: 1, action: "CREATE", actor_id: USER, created_at: head.created_at, payload_enc: "encrypted" }]; if (table === "named_table_view_versions" && revokeDuringVersion) roles = []; return Promise.resolve({ data: single ? values[0] ?? null : values, error: null, count }).then(resolve); } };
    return q;
  });
});
describe("named layout uses the existing role-aware table engine", () => {
  it("rejects forged fields, duplicate columns and route-table mismatch", () => {
    expect(() => CreateNamedViewSchema.parse({ ...create(), companyId: COMPANY })).toThrow();
    expect(() => NamedViewCommandSchema.parse({ action: "archive", expectedRevision: 0, idempotencyKey: KEY })).toThrow();
    expect(() => validateNamedView(create().view, "runs", ["HR_APPROVER"])).toThrow();
    expect(() => validateNamedView({ ...create().view, columns: ["code", "code"] }, "workers", ["HR_APPROVER"])).toThrow();
  });
  it("never widens restricted columns/filters and reuses current custom-resource allowlists", () => {
    expect(() => validateNamedView(create().view, "workers", ["VIEWER"])).toThrow();
    expect(() => validateNamedView({ ...defaultView("lines", ["VIEWER"]), columns: ["gross"] }, "lines", ["VIEWER"])).toThrow();
    const v = { ...defaultView("workers", ["HR_APPROVER"]), columns: ["code", "r_custom"] };
    expect(() => validateNamedView(v, "workers", ["HR_APPROVER"])).toThrow();
    expect(validateNamedView(v, "workers", ["HR_APPROVER"], [{ id: "r_custom", label: "Resource", type: "number", roles: ["HR_APPROVER"] }])).toEqual(v);
  });
});
describe("encrypted personal/team version persistence", () => {
  it("rechecks current membership before opening saved payloads", async () => {
    roles = []; await expect(listNamedViews(calls as never, actor, "workers")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.open).not.toHaveBeenCalled();
    roles = ["HR_APPROVER"]; revokeDuringVersion = true;
    await expect(loadNamedView(calls as never, actor, "workers", ID)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.open).not.toHaveBeenCalled();
  });
  it("rejects foreign personal owner/company heads before decrypt", async () => {
    head.owner_id = KEY;
    await expect(loadNamedView(calls as never, actor, "workers", ID)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(calls.open).not.toHaveBeenCalled();
    head.owner_id = USER; head.company_id = "foreign";
    await expect(loadNamedView(calls as never, actor, "workers", ID)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(calls.open).not.toHaveBeenCalled();
  });
  it("fails closed when roles change while opening a definition", async () => {
    calls.open.mockImplementation(async () => { roles = ["VIEWER"]; return payload; });
    await expect(loadNamedView(calls as never, actor, "workers", ID)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not return earlier list names after a role change at the response boundary", async () => {
    const from = calls.from.getMockImplementation()!;
    let membershipReads = 0;
    calls.from.mockImplementation((table: string) => {
      const query = from(table), then = query.then;
      if (table === "memberships") query.then = (resolve: (value: unknown) => unknown) => {
        if (++membershipReads === 4) roles = ["VIEWER"];
        return then(resolve);
      };
      return query;
    });
    await expect(listNamedViews(calls as never, actor, "workers")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.open).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated history and oversized command fields", async () => {
    count = 101;
    await expect(loadNamedView(calls as never, actor, "workers", ID)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls.open).not.toHaveBeenCalled();
    expect(() => CreateNamedViewSchema.parse({ ...create(), name: "x".repeat(81) })).toThrow();
    expect(() => CreateNamedViewSchema.parse({ ...create(), view: { ...create().view, search: "x".repeat(101) } })).toThrow();
    expect(() => validateNamedView({ ...create().view, filters: [{ column: "base", op: "contains", value: "123" }] }, "workers", ["HR_APPROVER"])).toThrow();
  });
  it("redacts incompatible team names/layouts/filter values rather than partially applying them", async () => {
    head.scope = "TEAM"; head.owner_id = KEY; roles = ["VIEWER"];
    const result = await loadNamedView(calls as never, actor, "workers", ID);
    expect(result).toMatchObject({ available: false, name: null, view: null, canEdit: false }); expect(JSON.stringify(result)).not.toContain("canary");
  });
  it("team writes require current HR/payroll while personal layout validation remains role-safe", async () => {
    roles = ["VIEWER"];
    await expect(createNamedView(calls as never, actor, "workers", { ...create(), scope: "TEAM" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.rpc).not.toHaveBeenCalled();
    head.scope = "TEAM";
    await expect(namedViewAction(calls as never, actor, "workers", ID, { action: "archive", expectedRevision: 1, idempotencyKey: KEY })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("stores encrypted payload through one atomic revision/idempotency/audit path without touching defaults", async () => {
    expect(await createNamedView(calls as never, actor, "workers", create())).toMatchObject({ id: ID, revision: 1 });
    const [name, args] = calls.rpc.mock.calls[0]; expect(name).toBe("append_named_table_view");
    expect(args).toMatchObject({ p_company: COMPANY, p_table: "workers", p_actor: USER, p_action: "CREATE", p_expected_revision: 0, p_idempotency_key: KEY, p_payload_enc: "sealed-name-filter-layout" }); expect(JSON.stringify(args)).not.toContain("canary");
    expect(reads.some(r => r.table === "table_layouts")).toBe(false);
  });
  it("archives without opening old restricted filters and exposes bounded history metadata", async () => {
    roles = ["VIEWER"]; head.archived = true;
    expect(await loadNamedView(calls as never, actor, "workers", ID)).toMatchObject({ archived: true, view: null, available: false }); expect(calls.open).not.toHaveBeenCalled();
    head.archived = false;
    await namedViewAction(calls as never, actor, "workers", ID, { action: "archive", expectedRevision: 1, idempotencyKey: KEY }); expect(calls.seal).not.toHaveBeenCalled();
  });
  it("maps stale/conflicting/not-found/removed-role atomic results without a fallback update", async () => {
    for (const code of ["CONFLICT", "FORBIDDEN", "NOT_FOUND"]) {
      calls.rpc.mockResolvedValue({ data: { code }, error: null });
      await expect(namedViewAction(calls as never, actor, "workers", ID, { action: "archive", expectedRevision: 1, idempotencyKey: KEY })).rejects.toMatchObject({ code });
    }
  });
});
