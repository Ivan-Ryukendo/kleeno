import { expect, it } from "vitest";
import { loadAllRows } from "@/server/db/paged";

type Row = { id: string; key?: number };
const make = (n: number) => Array.from({ length: n }, (_, i): Row => ({ id: `r-${String(i).padStart(5, "0")}`, key: i }));
const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : 1);
/** Fake PostgREST keyset source: ordered by id, rows after the cursor, server cap per response, hook may mutate the table between calls. */
function source(initial: Row[], cap = 1000, hook?: (call: number, table: Row[]) => void) {
  const table = [...initial]; const cursors: (string | null)[] = []; let n = 0;
  const page = async (after: string | null, size: number) => {
    hook?.(n++, table); cursors.push(after);
    const rest = table.filter(r => after === null || r.id > after).sort(byId);
    return { data: rest.slice(0, Math.min(size, cap)), count: rest.length, error: null as { code?: string } | null };
  };
  return { page, cursors, table };
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
it("continues by keyset cursor when the server returns fewer rows than requested", async () => {
  const s = source(make(1200), 300);
  expect(await loadAllRows(s.page, "rows", { pageSize: 500 })).toHaveLength(1200);
  expect(s.cursors[0]).toBeNull(); expect(s.cursors[1]).toBe("r-00299");
});
it("a single-page read is one request", async () => {
  const s = source(make(40));
  await loadAllRows(s.page, "rows");
  expect(s.cursors).toEqual([null]);
});
it("fails closed when the exact count is missing", async () => {
  await expect(loadAllRows(async () => ({ data: make(3), count: null, error: null }), "rows")).rejects.toThrow(/incomplete/);
});
it("fails closed on a database error without echoing the message", async () => {
  await expect(loadAllRows(async () => ({ data: null, count: null, error: { code: "57014" } }), "rows")).rejects.toThrow("db rows failed (57014)");
});
it("fails closed when rows are inserted or deleted mid-read", async () => {
  await expect(loadAllRows(source(make(1500), 1000, (call, t) => { if (call === 1) t.push({ id: "r-99999" }); }).page, "rows")).rejects.toThrow(/changed/);
  await expect(loadAllRows(source(make(1500), 1000, (call, t) => { if (call === 1) t.pop(); }).page, "rows")).rejects.toThrow(/changed/);
});
it("fails closed on a count-preserving delete+insert swap between pages (behind and ahead of the cursor)", async () => {
  await expect(loadAllRows(source(make(1500), 1000, (call, t) => { if (call === 1) { t.shift(); t.push({ id: "r-000005" }); } }).page, "rows", { pageSize: 500 })).rejects.toThrow(/changed/);
  await expect(loadAllRows(source(make(1500), 1000, (call, t) => { if (call === 3) { t.pop(); t.push({ id: "r-01499x" }); } }).page, "rows", { pageSize: 500 })).rejects.toThrow(/changed/);
});
it("an update to an ordering column cannot make a row skip the cursor", async () => {
  // rows are paged by id, so changing the business key (e.g. a pseudonym) between pages leaves the set intact
  const s = source(make(1500), 1000, (call, t) => { if (call === 1) t[0] = { ...t[0], key: 99999 }; });
  const rows = await loadAllRows(s.page, "rows", { pageSize: 500 });
  expect(rows.map(r => r.id)).toEqual(make(1500).map(r => r.id));
});
it("rejects duplicate or missing ids and an empty page that would loop", async () => {
  await expect(loadAllRows(async () => ({ data: [{ id: "a" }, { id: "a" }], count: 2, error: null }), "rows")).rejects.toThrow(/duplicate/);
  await expect(loadAllRows(async () => ({ data: [], count: 5, error: null }), "rows")).rejects.toThrow(/incomplete/);
  await expect(loadAllRows(async () => ({ data: [{} as Row], count: 1, error: null }), "rows")).rejects.toThrow(/duplicate or missing/);
});
it("rejects a table above the supported ceiling before reading it all", async () => {
  const s = source(make(30), 1000);
  await expect(loadAllRows(s.page, "rows", { max: 20 })).rejects.toThrow(/supported/);
  expect(s.cursors).toEqual([null]);
});
