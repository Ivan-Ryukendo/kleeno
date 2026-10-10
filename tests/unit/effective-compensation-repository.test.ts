import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ open: vi.fn(), seal: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.open, sealJson: mocks.seal, fingerprint: async () => "f".repeat(64) }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc }), must: (value: { data: unknown; error: unknown }) => { if (value.error || !value.data) throw new Error("DB unavailable"); return value.data; } }));
import { loadEffectiveCompensation, scheduleCompensation } from "@/server/db/effective-compensation";
const id = "10000000-0000-4000-8000-000000000001";
const who = { companyId: id, userId: id, roles: ["HR_APPROVER"] as const, correlationId: "test" };
beforeEach(() => vi.clearAllMocks());
it("rejects nonfinancial reads and nonpayroll writes before any encrypted evidence read", async () => {
  const from = vi.fn(), reader = { from } as unknown as SupabaseClient;
  await expect(loadEffectiveCompensation(reader, { ...who, roles: ["VIEWER"] }, id)).rejects.toThrow();
  await expect(scheduleCompensation(reader, { ...who, roles: ["PAYMENT_APPROVER"] }, id, {} as never)).rejects.toThrow();
  expect(from).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("revoked current membership prevents baseline and schedule decryption", async () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { roles: ["OWNER"], removed_at: null }, error: null }) };
  const reader = { from: vi.fn(() => q) } as unknown as SupabaseClient;
  await expect(loadEffectiveCompensation(reader, who, id)).rejects.toThrow("Current membership");
  expect(mocks.open).not.toHaveBeenCalled();
});

const changeId = "20000000-0000-4000-8000-000000000002";
function readerFixture(history: object[] = []) {
  let allowed = true;
  const reader = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const data = () => table === "memberships" ? { roles: allowed ? ["HR_APPROVER"] : ["OWNER"], removed_at: null } : table === "workers" ? { id, active: true, pay_type: "SALARIED" } : table === "compensations" ? { id, version: 3, payload_enc: "BASELINE" } : table === "effective_compensations" ? history : [];
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, order: () => q, limit: () => q, gte: () => q,
      range: async () => ({ data: Array.isArray(data()) ? data() : [], count: Array.isArray(data()) ? (data() as unknown[]).length : 0, error: null }),
      maybeSingle: async () => ({ data: table === "effective_compensations" && filters.idempotency_key ? null : data(), error: null }) }; return q;
  } } as unknown as SupabaseClient;
  mocks.open.mockImplementation(async (_company, _table, _field, _id, value) => value === "BASELINE" ? { baseAmount: "3100000000", hourlyRate: "0" } : { baseAmount: "6200000000", hourlyRate: "0", reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE" });
  return { reader, revoke: () => { allowed = false; } };
}
it("decrypts the original pinned baseline and previews future rates only on their applicable dates", async () => {
  const f = readerFixture([{ id: changeId, worker_id: id, revision: 1, effective_from: "2026-01-16", pay_type: "SALARIED", baseline_compensation_id: id, baseline_compensation_version: 3, supersedes_id: null, payload_enc: "CHANGE", actor_id: id, created_at: "2026-01-01T00:00:00Z" }]);
  const view = await loadEffectiveCompensation(f.reader, who, id, { period: { start: "2026-01-01", end: "2026-01-31" } });
  expect(view.baseline.id).toBe(id); expect(view.revision).toBe(1);
  expect(view.segments?.map(value => value.baseAmount)).toEqual(["3100000000", "6200000000"]);
  expect(view.history[0]).toMatchObject({ reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE" });
});
it("schedules only encrypted rate/reason/source with safe baseline/impact/revision bindings and rejects stale preview", async () => {
  const f = readerFixture(); mocks.seal.mockResolvedValue("ENCRYPTED"); mocks.rpc.mockResolvedValue({ data: { code: "OK", id: changeId, revision: 1 }, error: null });
  const command = { effectiveFrom: "2026-01-16", payType: "SALARIED" as const, baseAmount: "6200000000", hourlyRate: "0", expectedRevision: 0, baselineCompensationId: id, baselineCompensationVersion: 3, supersedesId: null, impactedRunIds: [], reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE", idempotencyKey: changeId };
  await expect(scheduleCompensation(f.reader, who, id, command)).resolves.toEqual({ id: changeId, revision: 1 });
  expect(mocks.seal).toHaveBeenCalledWith(id, "effective_compensations", "payload_enc", expect.any(String), { baseAmount: "6200000000", hourlyRate: "0", reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE" });
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("PRIVATE-"); expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("6200000000");
  mocks.rpc.mockClear(); await expect(scheduleCompensation(f.reader, who, id, { ...command, impactedRunIds: [id] })).rejects.toThrow("affected periods"); expect(mocks.rpc).not.toHaveBeenCalled();
});
