import { expect, it, vi } from "vitest";
import { CONFIG } from "../fixtures/payroll/cases";
// R3.1b: reconciliation and import reads page through PostgREST's 1,000-row cap instead of failing or truncating.
const tables = vi.hoisted(() => new Map<string, Record<string, unknown>[]>());
const orders = vi.hoisted(() => [] as string[]);
vi.mock("@/server/db/client", () => ({ db: () => reader, must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("database unavailable"); return r.data; } }));
vi.mock("@/server/db/configs", () => ({ loadConfig: async () => ({ config: CONFIG, confirmedOverrideKeys: [] }) }));
vi.mock("@/server/db/workers", () => ({ listWorkers: async () => [] }));
vi.mock("@/server/crypto", () => ({ openJson: async () => [], openField: vi.fn(), sealJson: vi.fn(), sealField: vi.fn() }));
vi.mock("@/server/ai/recon", () => ({ suggestForExceptions: vi.fn() }));
vi.mock("@/server/db/audit", () => ({ writeAudit: vi.fn() }));
const reader = { from(table: string) {
  let cursor: string | null = null, lim = 1000; const ord: string[] = [];
  const q = { select: () => q, eq: () => q, in: () => q, gt: (_c: string, v: string) => { cursor = v; return q; }, order: (c: string) => { ord.push(c); return q; }, limit: (n: number) => { lim = n; return q; },
    then: (res: (v: unknown) => unknown) => { orders.push(`${table}:${ord.join(",")}`); const rest = (tables.get(table) ?? []).filter((r) => cursor === null || String(r.id) > cursor).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)); return res({ data: rest.slice(0, Math.min(lim, 1000)), error: null, count: rest.length }); } };
  return q;
} };
import { loadInput, loadResolutions } from "@/server/db/reconciliation";
const run = { id: "run", status: "DATA_IMPORTED", config_version: 1, period_start: "2026-10-05", period_end: "2026-10-25" };
it("loadInput returns every one of 1,050 timesheets and leave rows in a deterministic order", async () => {
  tables.set("timesheets", Array.from({ length: 1050 }, (_, i) => ({ id: `t${i}`, worker_id: `w${i % 50}`, work_date: "2026-10-05", hours: 8, approved_extra_hours: 0 })));
  tables.set("leave_records", Array.from({ length: 1020 }, (_, i) => ({ id: `l${i}`, worker_id: `w${i % 50}`, leave_date: "2026-10-06", leave_type: "PAID", hours: 8 })));
  const input = await loadInput("company", run);
  expect(input.timesheets).toHaveLength(1050);
  expect(input.leave).toHaveLength(1020);
  expect(orders.filter((o) => o.startsWith("timesheets:"))[0]).toBe("timesheets:id");
});
it("loadResolutions reads more than 1,000 resolved exceptions", async () => {
  tables.set("exceptions", Array.from({ length: 1100 }, (_, i) => ({ id: `e${i}`, dedupe_key: `k${i}`, resolution_action: "KEEP_FIRST" })));
  expect((await loadResolutions("company", "run")).size).toBe(1100);
});
vi.mock("@/core/domain/transition", () => ({ applyTransition: vi.fn() }));
vi.mock("@/server/db/effective-compensation", () => ({ effectiveCompensationAccess: vi.fn(), effectiveScheduleRevisions: async () => new Map(), loadEffectiveCompensation: vi.fn() }));
vi.mock("@/server/db/calculations", () => ({ saveCalculation: vi.fn(), loadLines: vi.fn() }));
import { loadRunAdjustments } from "@/server/db/calculate";
it("calculate path: run adjustments load across pages with the same keyset reader", async () => {
  tables.set("run_adjustments", Array.from({ length: 1300 }, (_, i) => ({ id: `a${String(i).padStart(4, "0")}`, worker_id: `w${i}`, payload_enc: "x" })));
  expect((await loadRunAdjustments(reader as never, "company", "run")).size).toBe(1300);
});
