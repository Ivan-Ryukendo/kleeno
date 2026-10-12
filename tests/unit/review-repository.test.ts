import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const calls = vi.hoisted(() => ({ rpc: vi.fn(), ready: vi.fn(), seal: vi.fn(), open: vi.fn(), lines: vi.fn(), payloads: new Map<string, unknown>(), events: [] as Record<string, unknown>[] }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: calls.rpc }), must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("database unavailable"); return r.data; } }));
vi.mock("@/server/db/review-readiness", () => ({ assertReviewReady: calls.ready }));
vi.mock("@/server/db/calculations", () => ({ loadLines: calls.lines }));
vi.mock("@/server/crypto", () => ({ fingerprint: async (company: string, value: unknown) => (await import("@/core/canonical")).canonicalHash({ company, value }), sealJson: calls.seal, openJson: calls.open }));
import { downloadReviewExport, payrollReviewAction } from "@/server/db/payroll-review";

const calcId = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222", hash = "a".repeat(64);
const who = { companyId: "company", userId: "user", roles: ["HR_APPROVER"] as const, correlationId: "request" };
const bound = { calculationId: calcId, calculationHash: hash };
const reader = { from: (table: string) => {
  const filters: Record<string, unknown> = {};
  const query = { select: (): unknown => query, eq: (field: string, value: unknown): unknown => { filters[field] = value; return query; }, order: (): unknown => query,
    maybeSingle: async () => ({ error: null, data: table === "payroll_runs" ? { id: "run", status: "CALCULATION_VALIDATED", config_version: 1, period_start: "2026-10-01", period_end: "2026-10-31" } : { id: calcId, calculation_hash: hash, config_version: 1 } }),
    single: async () => ({ error: null, data: { snapshot_enc: "snapshot" } }),
    limit: async () => ({ error: null, data: calls.events.filter(row => Object.entries(filters).every(([field, value]) => row[field] === value)).sort((a, b) => Number(b.revision) - Number(a.revision)).slice(0, 1) }),
  }; return query;
} } as unknown as SupabaseClient;

beforeEach(() => {
  vi.resetAllMocks(); calls.events.length = 0; calls.payloads.clear();
  calls.ready.mockResolvedValue({ settingsRevision: 7 });
  calls.seal.mockImplementation(async (_company, _table, _column, id, payload) => { calls.payloads.set(id, payload); return "ENCRYPTED"; });
  calls.open.mockImplementation(async (_company, table, _column, id) => table === "calculations" ? { entries: [{ worker: { workerId: "worker" } }] } : calls.payloads.get(id));
  calls.lines.mockResolvedValue([{ workerId: "worker", gross: 5n, deductions: 1n, net: 4n, trace: [{ amount: 5n }, { amount: -1n }] }]);
  calls.rpc.mockImplementation(async (_name, params) => { const event = params.p_event; calls.events.push({ ...event, company_id: "company", run_id: "run", actor_id: "user", revision: calls.events.length + 1, created_at: "2026-10-07T00:00:00Z" }); return { data: { code: "OK", id: event.id }, error: null }; });
});

it("pins server readiness and appends signoff through one atomic RPC with no financial mutation", async () => {
  const out = await payrollReviewAction(reader, who, "run", { ...bound, action: "signoff", idempotencyKey: key, expectedRevision: 0 });
  expect(out.view).toMatchObject({ revision: 1, signoff: { actor: "user" }, export: null });
  expect(calls.rpc).toHaveBeenCalledExactlyOnceWith("append_payroll_review", expect.objectContaining({ p_actor: "user", p_company: "company", p_run: "run", p_event: expect.objectContaining({ settings_revision: 7, calculation_hash: hash, payload_enc: null }) }));
});

it("does not write when readiness is blocked", async () => {
  calls.ready.mockRejectedValue(new Error("required evidence missing"));
  await expect(payrollReviewAction(reader, who, "run", { ...bound, action: "signoff", idempotencyKey: key, expectedRevision: 0 })).rejects.toThrow("required evidence missing");
  expect(calls.rpc).not.toHaveBeenCalled();
});

it("refuses truncated workers or invalid trace before committing an export", async () => {
  await payrollReviewAction(reader, who, "run", { ...bound, action: "signoff", idempotencyKey: key, expectedRevision: 0 });
  for (const lines of [[], [{ workerId: "worker", gross: 5n, deductions: 1n, net: 4n, trace: [{ amount: 5n }] }]]) {
    calls.lines.mockResolvedValue(lines);
    await expect(payrollReviewAction(reader, who, "run", { ...bound, action: "export", idempotencyKey: "33333333-3333-4333-8333-333333333333", expectedRevision: 1 })).rejects.toThrow("complete immutable worker calculation");
  }
  expect(calls.rpc).toHaveBeenCalledTimes(1);
});

it("encrypts acknowledgement evidence, reproduces attachment bytes, and keeps status manual", async () => {
  await payrollReviewAction(reader, who, "run", { ...bound, action: "signoff", idempotencyKey: key, expectedRevision: 0 });
  const out = await payrollReviewAction(reader, who, "run", { ...bound, action: "export", idempotencyKey: "33333333-3333-4333-8333-333333333333", expectedRevision: 1 });
  expect(await downloadReviewExport(reader, "company", "run")).toEqual(out.download);
  calls.ready.mockRejectedValue(new Error("ack does not require readiness"));
  const ack = await payrollReviewAction(reader, who, "run", { ...bound, action: "acknowledge", status: "MANUAL_REJECTED", reference: "PRIVATE-RECEIPT", idempotencyKey: "44444444-4444-4444-8444-444444444444", expectedRevision: 2 });
  expect(ack.view.acknowledgement).toMatchObject({ status: "MANUAL_REJECTED", reference: "PRIVATE-RECEIPT" });
  expect(calls.rpc.mock.calls[2][1].p_event.payload_enc).toBe("ENCRYPTED");
  expect(JSON.stringify(calls.rpc.mock.calls)).not.toContain("PRIVATE-RECEIPT");
});
