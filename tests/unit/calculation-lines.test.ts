import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/server/db/client", () => ({ must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data === null) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ sealJson: vi.fn(), openJson: vi.fn() }));
import { openJson } from "@/server/crypto";
import { loadLines } from "@/server/db/calculations";
const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `line-${String(i).padStart(4, "0")}`, worker_id: `worker-${i}`, net: "1000000", gross_enc: "gross", deductions_enc: "deductions", trace_enc: "trace" }));
function fixture(cap = 250, missingCount = false, duplicatePage = false) {
  const filters: unknown[][] = [], offsets: number[] = [];
  const reader = { from: () => {
    let start = 0, end = rows.length, exact = false;
    const query = {
      select(_columns: string, options?: { count?: string }) { exact = options?.count === "exact"; return query; },
      eq(...args: unknown[]) { filters.push(args); return query; },
      order() { return query; },
      range(from: number, to: number) { start = from; end = to + 1; offsets.push(from); return query; },
      then(resolve: (value: unknown) => unknown) { const offset = duplicatePage ? 0 : start; return Promise.resolve(resolve({ data: rows.slice(offset, Math.min(end, offset + cap)), count: exact && !missingCount ? rows.length : null, error: null })); },
    }; return query;
  } } as unknown as SupabaseClient;
  return { reader, filters, offsets };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openJson).mockImplementation(async (_company, _table, column) => (column === "trace_enc" ? [] : column === "gross_enc" ? "1000000" : "0") as never);
});
it("reads every captured line despite a lower server cap with exact tenant-scoped pagination", async () => {
  const { reader, filters, offsets } = fixture();
  const lines = await loadLines(reader, "company", "calculation");
  expect(lines).toHaveLength(1001);
  expect(lines.reduce((sum, line) => sum + line.net, 0n)).toBe(1001000000n);
  expect(offsets).toEqual([0, 250, 500, 750, 1000]);
  expect(filters.filter(([key]) => key === "company_id").every(([, value]) => value === "company")).toBe(true);
});
it("does not decrypt or return a complete-looking result when exact count is missing", async () => {
  await expect(loadLines(fixture(250, true).reader, "company", "calculation")).rejects.toThrow();
  expect(openJson).not.toHaveBeenCalled();
});
it("rejects repeated page rows before returning money", async () => {
  await expect(loadLines(fixture(250, false, true).reader, "company", "calculation")).rejects.toThrow();
});
