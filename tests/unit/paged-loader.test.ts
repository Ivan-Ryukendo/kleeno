import { expect, it } from "vitest";
import { loadAllRows } from "@/server/db/paged";

type Row = { id: string };
const make = (n: number) => Array.from({ length: n }, (_, i): Row => ({ id: `r-${String(i).padStart(5, "0")}` }));
/** Fake PostgREST: server cap per response, optional hook to mutate the table between calls. */
function source(initial: Row[], cap = 1000, hook?: (call: number, table: Row[]) => void) {
  const table = [...initial]; const calls: number[] = []; let n = 0;
  const page = async (from: number, to: number) => {
    hook?.(n++, table); calls.push(from);
    return { data: table.slice(from, Math.min(to + 1, from + cap)), count: table.length, error: null as { code?: string } | null };
  };
  return { page, calls, table };
}

it("loads more than 1,000 rows through a capped server with an exact count", async () => {
  const rows = await loadAllRows(source(make(2503)).page, "rows");
  expect(rows).toHaveLength(2503);
  expect(new Set(rows.map(r => r.id)).size).toBe(2503);
  expect(rows[2502].id).toBe("r-02502");
});
it("loads an empty table and an exact multiple of the page size", async () => {
  expect(await loadAllRows(source([]).page, "rows")).toEqual([]);
  expect(await loadAllRows(source(make(1000)).page, "rows")).toHaveLength(1000);
});
it("continues by offset when the server returns fewer rows than requested", async () => {
  expect(await loadAllRows(source(make(1200), 300).page, "rows", { pageSize: 500 })).toHaveLength(1200);
});
it("fails closed when the exact count is missing", async () => {
  await expect(loadAllRows(async () => ({ data: make(3), count: null, error: null }), "rows")).rejects.toThrow(/incomplete/);
});
it("fails closed on a database error without echoing the message", async () => {
  await expect(loadAllRows(async () => ({ data: null, count: null, error: { code: "57014" } }), "rows")).rejects.toThrow("db rows failed (57014)");
});
it("fails closed when rows are inserted mid-read", async () => {
  const s = source(make(1500), 1000, (call, t) => { if (call === 1) t.push({ id: "r-99999" }); });
  await expect(loadAllRows(s.page, "rows")).rejects.toThrow(/changed/);
});
it("fails closed when a row is deleted mid-read", async () => {
  const s = source(make(1500), 1000, (call, t) => { if (call === 1) t.pop(); });
  await expect(loadAllRows(s.page, "rows")).rejects.toThrow(/changed/);
});
it("fails closed when the table changes after the last page (final re-count)", async () => {
  const s = source(make(700), 1000, (call, t) => { if (call === 1) t.push({ id: "r-99999" }); });
  await expect(loadAllRows(s.page, "rows")).rejects.toThrow(/changed/);
});
it("rejects duplicate or missing ids and an empty page that would loop", async () => {
  await expect(loadAllRows(async () => ({ data: [{ id: "a" }, { id: "a" }], count: 2, error: null }), "rows")).rejects.toThrow(/duplicate/);
  await expect(loadAllRows(async () => ({ data: [], count: 5, error: null }), "rows")).rejects.toThrow(/incomplete/);
  await expect(loadAllRows(async () => ({ data: [{} as Row], count: 1, error: null }), "rows")).rejects.toThrow(/duplicate or missing/);
});
it("rejects a table above the supported ceiling before reading it all", async () => {
  const s = source(make(30), 1000);
  await expect(loadAllRows(s.page, "rows", { max: 20 })).rejects.toThrow(/supported/);
  expect(s.calls).toEqual([0]);
});
