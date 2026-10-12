import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), admin: vi.fn(), seal: vi.fn(), open: vi.fn(), fingerprint: vi.fn(), guards: [] as unknown[] }));
vi.mock("@/server/db/client", () => ({ db: () => calls, must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("scoped database read failed"); return r.data; } }));
vi.mock("@/server/db/growth", () => ({ isPlatformAdmin: calls.admin }));
vi.mock("@/server/crypto", () => ({ sealJson: calls.seal, openJson: calls.open, fingerprint: calls.fingerprint }));
vi.mock("@/server/auth/guard", () => ({ guarded: (options: unknown, fn: unknown) => { calls.guards.push(options); return fn; } }));
import { CreateSupportSchema, SupportAdminCommandSchema, SupportUserCommandSchema } from "@/core/support";
import { createSupport, listSupport, loadSupport, loadAdminSupport, supportAction, adminSupportAction } from "@/server/db/support";

const COMPANY = "11111111-1111-4111-8111-111111111111", USER = "22222222-2222-4222-8222-222222222222", TICKET = "33333333-3333-4333-8333-333333333333", KEY = "44444444-4444-4444-8444-444444444444";
const who = { companyId: COMPANY, userId: USER, correlationId: KEY };
const create = () => ({ idempotencyKey: KEY, category: "REVIEW" as const, severity: "NORMAL" as const, subject: "Private subject canary", body: "Private support body canary", evidenceRefs: ["Private submitted evidence canary"] });
const request = () => ({ id: TICKET, company_id: COMPANY, requester_id: USER, category: "REVIEW", severity: "NORMAL", status: "OPEN", assignee_id: null, revision: 2, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T01:00:00Z" });
let member: boolean, ticket: ReturnType<typeof request> | null;
let events: Record<string, unknown>[];
let pageRows: ReturnType<typeof request>[] | null, reportedCount: number | undefined;
let revokeDuringHistory: boolean;
const reads: { table: string; filters: [string, unknown][] }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); member = true; ticket = request(); pageRows = null; reportedCount = undefined; revokeDuringHistory = false; reads.length = 0;
  events = [{ id: "public-event", company_id: COMPANY, request_id: TICKET, action: "CREATE", visibility: "CUSTOMER", actor_id: USER, revision: 1, payload_enc: "public-cipher", created_at: "2026-10-07T00:00:00Z", status: "OPEN", severity: "NORMAL", assignee_id: null }, { id: "internal-event", company_id: COMPANY, request_id: TICKET, action: "NOTE", visibility: "INTERNAL", actor_id: "staff", revision: 2, payload_enc: "internal-cipher", created_at: "2026-10-07T01:00:00Z", status: "OPEN", severity: "NORMAL", assignee_id: null }];
  calls.admin.mockResolvedValue(true); calls.seal.mockResolvedValue("sealed-confidential-payload"); calls.fingerprint.mockResolvedValue("a".repeat(64)); calls.rpc.mockResolvedValue({ data: { code: "OK", id: TICKET, revision: 3 }, error: null });
  calls.open.mockImplementation(async (_company, _table, _column, _id, ciphertext) => ciphertext === "public-cipher" ? { subject: "Submitted subject", body: "Customer-visible body", evidenceRefs: ["submitted-ref"] } : { body: "Internal secret note", evidenceRefs: [] });
  calls.from.mockImplementation((table: string) => {
    const read = { table, filters: [] as [string, unknown][] }; reads.push(read); let single = false;
    const q = { select() { return q; }, eq(key: string, value: unknown) { read.filters.push([key, value]); return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { single = true; return q; },
      then(resolve: (v: unknown) => unknown) {
        let rows: Record<string, unknown>[] = table === "memberships" ? member ? [{ company_id: COMPANY, user_id: USER }] : [] : table === "support_requests" ? pageRows ?? (ticket ? [ticket] : []) : events;
        rows = rows.filter(row => read.filters.every(([key, value]) => row[key] === value));
        if (table === "support_events" && revokeDuringHistory) member = false;
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: table === "support_events" ? reportedCount ?? rows.length : rows.length }).then(resolve);
      } };
    return q;
  });
});

describe("strict submitted support commands", () => {
  it("rejects forged tenant/roles, oversized text, and payment operations", () => {
    expect(() => CreateSupportSchema.parse({ ...create(), companyId: COMPANY })).toThrow();
    expect(() => CreateSupportSchema.parse({ ...create(), body: "x".repeat(2001) })).toThrow();
    expect(() => SupportUserCommandSchema.parse({ action: "triage", expectedRevision: 1, idempotencyKey: KEY, status: "RESOLVED" })).toThrow();
    expect(() => SupportAdminCommandSchema.parse({ action: "pay", expectedRevision: 1, idempotencyKey: KEY })).toThrow();
    expect(() => SupportUserCommandSchema.parse({ action: "reply", expectedRevision: 0, idempotencyKey: KEY, body: "reply" })).toThrow();
  });
  it("has explicit customer reply/close and staff internal-note contracts", () => {
    expect(SupportUserCommandSchema.parse({ action: "close", expectedRevision: 1, idempotencyKey: KEY }).action).toBe("close");
    expect(SupportAdminCommandSchema.parse({ action: "note", expectedRevision: 1, idempotencyKey: KEY, body: "Internal" })).toMatchObject({ action: "note", evidenceRefs: [] });
  });
});
describe("support repository authority and confidentiality", () => {
  it("rechecks current membership before listing or decrypting", async () => {
    member = false;
    await expect(listSupport(who)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(loadSupport(who, TICKET)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.open).not.toHaveBeenCalled();
  });
  it("revocation during a history read blocks opening the fetched ciphertext", async () => {
    revokeDuringHistory = true;
    await expect(loadSupport(who, TICKET)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.open).not.toHaveBeenCalled();
  });
  it("customer reads filter by tenant/requester and never decrypt internal notes", async () => {
    const value = await loadSupport(who, TICKET);
    expect(value.ticket.subject).toBe("Submitted subject"); expect(value.messages).toHaveLength(1);
    expect(calls.open).toHaveBeenCalledExactlyOnceWith(COMPANY, "support_events", "payload_enc", "public-event", "public-cipher");
    expect(reads.find(r => r.table === "support_requests")?.filters).toEqual(expect.arrayContaining([["company_id", COMPANY], ["requester_id", USER], ["id", TICKET]]));
    expect(reads.find(r => r.table === "support_events")?.filters).toContainEqual(["visibility", "CUSTOMER"]);
  });
  it("marks capped metadata lists and refuses capped message evidence before decrypt", async () => {
    pageRows = Array.from({ length: 101 }, (_, index) => ({ ...request(), id: String(index) }));
    const list = await listSupport(who);
    expect(list.hasMore).toBe(true); expect(list.tickets).toHaveLength(100); expect(JSON.stringify(list)).not.toContain("body");
    pageRows = null; reportedCount = 1001;
    await expect(loadSupport(who, TICKET)).rejects.toMatchObject({ code: "CONFLICT" }); expect(calls.open).not.toHaveBeenCalled();
  });
  it.each(["company", "requester"])("foreign %s request rejects before decrypt", async boundary => {
    if (boundary === "company") ticket!.company_id = "foreign"; else ticket!.requester_id = "another-user";
    await expect(loadSupport(who, TICKET)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(calls.open).not.toHaveBeenCalled();
  });
  it("removed staff cannot decrypt; current staff sees explicitly separate internal visibility", async () => {
    calls.admin.mockResolvedValue(false);
    await expect(loadAdminSupport({ userId: USER }, TICKET)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.open).not.toHaveBeenCalled();
    calls.admin.mockResolvedValue(true);
    const value = await loadAdminSupport({ userId: USER }, TICKET);
    expect(value.messages.map(m => m.visibility)).toEqual(["CUSTOMER", "INTERNAL"]); expect(value.messages[1].body).toBe("Internal secret note");
  });
  it("encrypts submitted content before the sole create+audit RPC and never sends raw payload", async () => {
    expect(await createSupport(who, create())).toEqual({ id: TICKET });
    const [name, args] = calls.rpc.mock.calls[0];
    expect(name).toBe("append_support_event"); expect(args).toMatchObject({ p_company: COMPANY, p_actor: USER, p_admin: false });
    const stored = JSON.stringify(args);
    expect(stored).not.toContain("Private"); expect(stored).toContain("sealed-confidential-payload");
    expect(calls.seal.mock.calls[0].slice(0, 3)).toEqual([COMPANY, "support_events", "payload_enc"]);
  });
  it("rechecks authority before replay and passes explicit optimistic revision/idempotency", async () => {
    const command = { action: "reply" as const, expectedRevision: 2, idempotencyKey: KEY, body: "Response", evidenceRefs: [] };
    await supportAction(who, TICKET, command);
    expect(calls.rpc.mock.calls[0][1].p_command).toMatchObject({ action: "REPLY", expected_revision: 2, idempotency_key: KEY, command_hash: "a".repeat(64) });
    member = false; await expect(supportAction(who, TICKET, command)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects stale/conflicting/unauthorized/not-found atomic results", async () => {
    for (const code of ["CONFLICT", "FORBIDDEN", "NOT_FOUND"]) {
      calls.rpc.mockResolvedValue({ data: { code }, error: null });
      await expect(adminSupportAction({ userId: USER, correlationId: KEY }, TICKET, { action: "note", expectedRevision: 2, idempotencyKey: KEY, body: "Internal", evidenceRefs: [] })).rejects.toMatchObject({ code });
    }
  });
  it("refuses assignment to a removed or nonstaff account", async () => {
    calls.admin.mockImplementation(async id => id === USER);
    await expect(adminSupportAction({ userId: USER, correlationId: KEY }, TICKET, { action: "triage", expectedRevision: 2, idempotencyKey: KEY, status: "IN_PROGRESS", severity: "NORMAL", assigneeId: COMPANY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.rpc).not.toHaveBeenCalled();
  });
});

it("routes reuse app and platform-admin guards without company-role admin shortcuts", async () => {
  await import("@/app/api/support/route"); await import("@/app/api/support/[id]/route"); await import("@/app/api/admin/support/route"); await import("@/app/api/admin/support/[id]/route");
  expect(calls.guards).toHaveLength(7);
  expect(calls.guards.slice(4).every(o => (o as { scope: string }).scope === "admin")).toBe(true);
  expect(calls.guards.every(o => !(o as { allowAal1?: boolean }).allowAal1)).toBe(true);
});
