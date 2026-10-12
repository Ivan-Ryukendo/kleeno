import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ open: vi.fn(), seal: vi.fn(), rpc: vi.fn(), lines: vi.fn(), verify: vi.fn() }));
vi.mock("@/core/workflow/evidence-pack", () => ({ verifyCapturedCalculation: mocks.verify }));
vi.mock("@/server/crypto", () => ({ openJson: mocks.open, sealJson: mocks.seal, fingerprint: async () => "f".repeat(64) }));
vi.mock("@/server/db/calculations", () => ({ loadLines: mocks.lines }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: mocks.rpc }), must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data === null) throw new Error("DB unavailable"); return result.data; } }));
import { linkReviewCorrection, loadReviewCorrections } from "@/server/db/review-corrections";

const id = "10000000-0000-4000-8000-000000000001", target = "20000000-0000-4000-8000-000000000002";
const actor = { companyId: id, userId: id, roles: ["HR_APPROVER"] as const, correlationId: "test" };
const command = { replacementRunId: target, originalCalculationId: id, replacementCalculationId: target, originalCalculationHash: "a".repeat(64), replacementCalculationHash: "b".repeat(64), originalReviewRevision: 1, replacementReviewRevision: 0 as const, idempotencyKey: id, reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE" };
let membership: unknown, mode: string, reads: string[], prior: unknown;
const reader = { from(table: string) {
  reads.push(table); const filters: Record<string, unknown> = {};
  const data = () => table === "memberships" ? membership : table === "payroll_runs" ? { id: filters.id, mode: filters.id === target ? mode : "LIVE_TESTNET", status: "CALCULATION_VALIDATED", period_start: "2026-10-01", period_end: "2026-10-31", config_version: 1 } : table === "calculations" ? { id: filters.run_id, calculation_hash: filters.run_id === target ? "b".repeat(64) : "a".repeat(64), config_version: 1, snapshot_enc: "SNAPSHOT" } : table === "payroll_review_events" && filters.run_id === id ? (filters.action ? { id, calculation_id: id, calculation_hash: "a".repeat(64) } : [{ revision: 1 }]) : [];
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, order: () => q, limit: () => q, or: () => q, maybeSingle: async () => ({ data: table === "review_corrections" ? prior : Array.isArray(data()) ? null : data(), error: null }), then: (resolve: (v: unknown) => unknown) => resolve({ data: data(), error: null }) }; return q;
} } as unknown as SupabaseClient;
beforeEach(() => { vi.resetAllMocks(); membership = { roles: ["HR_APPROVER"], removed_at: null }; mode = "SIMULATION"; reads = []; prior = null; mocks.open.mockResolvedValue({ entries: [{ worker: { workerId: "W001" } }] }); mocks.lines.mockImplementation(async (_reader, _company, calc) => [{ workerId: "W001", gross: calc === target ? 120n : 100n, deductions: 0n, net: calc === target ? 120n : 100n, trace: [{ amount: calc === target ? 120n : 100n }] }]); mocks.seal.mockResolvedValue("ENCRYPTED"); mocks.rpc.mockResolvedValue({ data: { code: "OK", id }, error: null }); });

it("rejects nonpayroll/currently revoked actors before private reads or mutation", async () => {
  await expect(linkReviewCorrection(reader, { ...actor, roles: ["PAYMENT_APPROVER"] }, id, command)).rejects.toThrow();
  expect(reads).toEqual([]);
  await expect(loadReviewCorrections(reader, { ...actor, roles: ["VIEWER"] }, id)).rejects.toThrow();
  expect(reads).toEqual([]);
  membership = null; await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow();
  expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects a live target without calculating a delta or calling the transaction", async () => {
  mode = "LIVE_TESTNET"; await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow();
  expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("encrypts exact bound delta/reason/source and sends only safe bindings plus ciphertext to the atomic RPC", async () => {
  await linkReviewCorrection(reader, actor, id, command);
  expect(mocks.seal).toHaveBeenCalledWith(id, "review_corrections", "payload_enc", expect.any(String), expect.objectContaining({ reason: "PRIVATE-REASON", source: "PRIVATE-SOURCE", delta: expect.objectContaining({ totals: { gross: "20", deductions: "0", net: "20" } }) }));
  expect(mocks.rpc).toHaveBeenCalledWith("link_review_correction", expect.objectContaining({ p_company: id, p_run: id, p_actor: id, p_event: expect.objectContaining({ original_signoff_id: id, replacement_run_id: target, payload_enc: "ENCRYPTED" }) }));
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("PRIVATE-");
  expect(mocks.verify).toHaveBeenCalledTimes(2);
});
it("fails incomplete captured lines before persistence and surfaces transactional stale/conflict denial", async () => {
  mocks.lines.mockResolvedValue([]);
  await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow("complete immutable");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.lines.mockResolvedValue([{ workerId: "W001", gross: 100n, deductions: 0n, net: 100n, trace: [{ amount: 100n }] }]);
  mocks.rpc.mockResolvedValue({ data: { code: "CONFLICT" }, error: null });
  await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow("changed or target is already linked");
});
it("replays committed identical evidence without private recomputation while current membership still gates retries", async () => {
  prior = { id, original_signoff_id: id, payload_enc: "ENCRYPTED", command_hash: "f".repeat(64) }; mode = "LIVE_TESTNET";
  await expect(linkReviewCorrection(reader, actor, id, command)).resolves.toEqual({ id });
  expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
  membership = { roles: ["OWNER"], removed_at: null }; mocks.rpc.mockClear();
  await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("stops tampered snapshot/hash reproduction and changed retry payloads before any write", async () => {
  mocks.verify.mockImplementationOnce(() => { throw new Error("immutable hash mismatch"); });
  await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow("immutable hash mismatch");
  expect(mocks.rpc).not.toHaveBeenCalled();
  prior = { id, original_signoff_id: id, payload_enc: "ENCRYPTED", command_hash: "a".repeat(64) };
  await expect(linkReviewCorrection(reader, actor, id, command)).rejects.toThrow("Retry key");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
