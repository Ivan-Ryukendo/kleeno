import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalString } from "@/core/canonical";
import { calculatePayroll } from "@/core/engine";
import { buildReviewExport } from "@/core/workflow/review";
import { CASES, CONFIG } from "../fixtures/payroll/cases";

const calls = vi.hoisted(() => ({ open: vi.fn(), lines: vi.fn() }));
vi.mock("@/server/crypto", () => ({ openJson: calls.open }));
vi.mock("@/server/db/calculations", () => ({ loadLines: calls.lines }));
vi.mock("@/server/db/client", () => ({ must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data == null) throw new Error("database unavailable"); return result.data; } }));
import { downloadEvidencePack } from "@/server/db/evidence-pack";

const id = "10000000-0000-4000-8000-000000000001";
const signoffId = "20000000-0000-4000-8000-000000000002";
const actor = { companyId: id, userId: id, roles: ["HR_APPROVER"] as const };
const calculation = calculatePayroll(CONFIG, [CASES[0].entry]);
const snapshot = JSON.parse(canonicalString({ config: CONFIG, entries: [CASES[0].entry] }));
const csv = buildReviewExport({ calculationId: id, calculationHash: calculation.calculationHash, configVersion: CONFIG.version, periodStart: "2026-10-01", periodEnd: "2026-10-31", lines: calculation.lines });
let membership: { roles: string[]; removed_at: string | null } | null;
let rows: Record<string, unknown>[];
let valid: boolean;
let wrongTenant: boolean;
let reads: string[];
let memberReads: number;
let revokeOnRecheck: boolean;
const reader = { from(table: string) {
  reads.push(table);
  const filters: Record<string, unknown> = {};
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; }, in: () => query,
    maybeSingle: async () => ({ error: null, data: table === "memberships" ? (++memberReads > 1 && revokeOnRecheck ? null : membership) : wrongTenant ? null : table === "payroll_runs" ? { id, config_version: CONFIG.version, status: valid ? "CALCULATION_VALIDATED" : "DRAFT", period_start: "2026-10-01", period_end: "2026-10-31" } : { id, config_version: CONFIG.version, calculation_hash: calculation.calculationHash, snapshot_enc: "SNAPSHOT" } }),
    then: (resolve: (result: unknown) => unknown) => resolve({ error: null, data: filters.company_id === id && filters.run_id === id ? rows : [], count: rows.length }),
  }; return query;
} } as unknown as SupabaseClient;

beforeEach(() => {
  vi.resetAllMocks(); membership = { roles: ["HR_APPROVER"], removed_at: null }; valid = true; wrongTenant = false; reads = []; memberReads = 0; revokeOnRecheck = false;
  rows = [{ id: signoffId, action: "SIGNOFF", calculation_id: id, calculation_hash: calculation.calculationHash, related_id: null, actor_id: id, created_at: "2026-10-07T12:00:00Z" }, { id, action: "EXPORT", calculation_id: id, calculation_hash: calculation.calculationHash, related_id: signoffId, created_at: "2026-10-07T12:01:00Z", payload_enc: "MANIFEST" }];
  calls.open.mockImplementation(async (_company, table) => table === "calculations" ? snapshot : { formatVersion: csv.formatVersion, byteHash: csv.byteHash, totals: csv.totals });
  calls.lines.mockResolvedValue(calculation.lines);
});

it("downloads only a fully reproduced immutable signed calculation", async () => {
  const result = await downloadEvidencePack(reader, actor, id);
  expect(result.filename).toBe(`kleeno-signed-calculation-v1-${id}.zip`);
  expect(result.bytes.byteLength).toBeGreaterThan(0);
  expect(calls.lines).toHaveBeenCalledWith(reader, id, id);
  expect(reads.every(table => ["memberships", "payroll_runs", "calculations", "payroll_review_events"].includes(table))).toBe(true);
});

it("denies masked roles, removed/currently downgraded members before private reads", async () => {
  for (const roles of [["OWNER"], ["VIEWER"]] as const) await expect(downloadEvidencePack(reader, { ...actor, roles }, id)).rejects.toThrow();
  expect(reads).toEqual([]);
  for (const member of [null, { roles: ["HR_APPROVER"], removed_at: "2026-10-07" }, { roles: ["OWNER"], removed_at: null }]) {
    membership = member; await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  }
  expect(reads.every(table => table === "memberships")).toBe(true);
  expect(calls.open).not.toHaveBeenCalled(); expect(calls.lines).not.toHaveBeenCalled();
});

it("refuses invalid IDs, wrong tenants and unvalidated runs before decryption", async () => {
  await expect(downloadEvidencePack(reader, actor, "not-a-uuid")).rejects.toThrow(); expect(reads).toEqual([]);
  wrongTenant = true; await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  wrongTenant = false; valid = false; await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  expect(calls.open).not.toHaveBeenCalled(); expect(calls.lines).not.toHaveBeenCalled();
});

it("requires bound sign-off and export evidence and refuses a lost membership before opening it", async () => {
  const original = rows;
  for (const evidence of [[], [original[0]], [original[1]], [original[0], { ...original[1], related_id: id }], [original[0], { ...original[1], calculation_hash: "f".repeat(64) }]]) {
    rows = evidence; await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  }
  rows = original; memberReads = 0; revokeOnRecheck = true;
  await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  expect(calls.open).not.toHaveBeenCalled(); expect(calls.lines).not.toHaveBeenCalled();
});

it("refuses altered export manifest or incomplete captured calculation", async () => {
  calls.open.mockImplementation(async (_company, table) => table === "calculations" ? snapshot : { formatVersion: csv.formatVersion, byteHash: "f".repeat(64), totals: csv.totals });
  await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
  calls.lines.mockResolvedValue([]); await expect(downloadEvidencePack(reader, actor, id)).rejects.toThrow();
});
