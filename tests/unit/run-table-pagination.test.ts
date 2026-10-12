import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/server/db/client", () => ({ must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ openField: vi.fn() }));
vi.mock("@/server/db/calculations", () => ({ loadLines: vi.fn() }));
vi.mock("@/server/db/reconciliation", () => ({ flaggedRecords: vi.fn(), listExceptions: vi.fn() }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn() }));
vi.mock("@/server/db/resources", () => ({ latestResourceInputs: vi.fn(), resourceColumnDef: vi.fn(), resourceColumns: vi.fn() }));
import { loadTableRows, queryTable } from "@/server/db/table-views";
import { defaultView } from "@/core/views";

type Run = { id: string; company_id: string; period_start: string; period_end: string; mode: string; status: string; created_at: string };
const run = (n: number, extra: Partial<Run> = {}): Run => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, company_id: "tenant", period_start: "2026-01-01", period_end: "2026-01-31", mode: "SIMULATION", status: "DRAFT", created_at: "2026-10-01T10:00:00.000000Z", ...extra });
function reader(rows: Run[], afterFirst?: (rows: Run[]) => void) {
  const reads: { table: string; filters: [string, unknown][]; cursor: string | null; max: number }[] = [];
  const client = { from(table: string) {
    const read = { table, filters: [] as [string, unknown][], cursor: null as string | null, max: Infinity }; reads.push(read);
    const order: { key: keyof Run; ascending: boolean }[] = [];
    let offset = 0;
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { read.filters.push([key, value]); return query; },
      order(key: keyof Run, opts: { ascending?: boolean } = {}) { order.push({ key, ascending: opts.ascending ?? true }); return query; },
      range(start: number, end: number) { offset = start; read.max = end - start + 1; return query; },
      limit(max: number) { read.max = max; return query; },
      or(cursor: string) { read.cursor = cursor; return query; },
      then(resolve: (value: unknown) => unknown) {
        let matched = rows.filter((row) => read.filters.every(([key, value]) => row[key as keyof Run] === value));
        if (read.cursor) {
          const parts = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^()]+)\)$/.exec(read.cursor);
          if (!parts || parts[1] !== parts[2]) throw new Error("unsupported cursor");
          matched = matched.filter((row) => row.created_at < parts[1] || (row.created_at === parts[1] && row.id < parts[3]));
        }
        matched.sort((a, b) => { for (const field of order) { if (a[field.key] !== b[field.key]) return (a[field.key] < b[field.key] ? -1 : 1) * (field.ascending ? 1 : -1); } return 0; });
        const page = matched.slice(offset, offset + read.max);
        if (reads.length === 1) afterFirst?.(rows);
        return Promise.resolve(resolve({ data: page, error: null }));
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

describe("bounded run history paging", () => {
  it.each([500, 501, 10000])("returns every distinct run across the %i boundary and keeps all reads tenant-scoped", async (count) => {
    const rows = Array.from({ length: count }, (_, n) => run(n + 1));
    const { client, reads } = reader([...rows, run(count + 1, { company_id: "other" })]);
    const loaded = await loadTableRows(client, "tenant", "runs", null);
    expect(new Set(loaded.map((row) => row.__rowId))).toEqual(new Set(rows.map((row) => row.id)));
    expect(loaded).toHaveLength(count);
    expect(reads.every((read) => read.table === "payroll_runs" && read.filters.some(([key, value]) => key === "company_id" && value === "tenant"))).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(21);
  });
  it("fails closed above 10,000 instead of returning a falsely complete export", async () => {
    const { client } = reader(Array.from({ length: 10001 }, (_, n) => run(n + 1)));
    await expect(loadTableRows(client, "tenant", "runs", null)).rejects.toThrow("supported limit");
  });
  it("does not duplicate or skip existing runs when new or backdated periods are inserted between reads", async () => {
    const rows = Array.from({ length: 1000 }, (_, n) => run(n + 1));
    const ids = new Set(rows.map((row) => row.id));
    const { client } = reader(rows, (current) => current.push(
      run(1001, { period_start: "2027-01-01", created_at: "2026-10-02T10:00:00.000000Z" }),
      run(1002, { period_start: "2025-01-01", created_at: "2026-10-02T10:00:00.000001Z" }),
    ));
    const loaded = await loadTableRows(client, "tenant", "runs", null);
    expect(loaded).toHaveLength(1000);
    expect(new Set(loaded.map((row) => row.__rowId))).toEqual(ids);
  });
  it("reports full totals and UI truncation while the export includes every loaded row", async () => {
    const rows = Array.from({ length: 501 }, (_, n) => run(n + 1));
    const def = defaultView("runs", ["VIEWER"]);
    const shown = await queryTable(reader(rows).client, "tenant", ["VIEWER"], def, null);
    expect(shown).toMatchObject({ total: 501, truncated: true });
    expect(shown.rows).toHaveLength(500);
    const exported = await queryTable(reader(rows).client, "tenant", ["VIEWER"], def, null, { all: true });
    expect(exported).toMatchObject({ total: 501, truncated: false });
    expect(exported.rows).toHaveLength(501);
  });
});
