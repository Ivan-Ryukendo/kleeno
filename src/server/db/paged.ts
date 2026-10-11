import "server-only";
/**
 * Paged, consistent-snapshot reads for calculation inputs (R3.1a; rule 14: the engine never sees a partial input set).
 * PostgREST caps a response (default 1,000 rows), so a bare select silently truncates. This loader asks for an exact
 * count, walks pages by offset, and fails closed on: a database error, a missing or changed count, duplicate or missing
 * ids, an empty page that would loop, or a table above the supported ceiling. A final re-count after the last page
 * detects rows inserted or deleted during the read. Callers must order by a total order (end with "id").
 */
type PageResult<T> = { data: T[] | null; error: { code?: string } | null; count: number | null };
type PageFn<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

export const PAGE_SIZE = 500;
export const MAX_ROWS = 100000;

export async function loadAllRows<T extends { id: string }>(page: PageFn<T>, what: string, opts: { pageSize?: number; max?: number } = {}): Promise<T[]> {
  const size = opts.pageSize ?? PAGE_SIZE, max = opts.max ?? MAX_ROWS;
  const rows: T[] = [], ids = new Set<string>();
  let total: number | null = null;
  const read = (r: PageResult<T>) => {
    if (r.error) throw new Error(`db ${what} failed${r.error.code ? ` (${r.error.code})` : ""}`);
    if (!r.data || r.count === null || !Number.isSafeInteger(r.count) || r.count < 0) throw new Error(`${what} evidence is incomplete`);
    if (r.count > max) throw new Error(`${what} exceeds the supported size`);
    if (total !== null && r.count !== total) throw new Error(`${what} changed while it was being read`);
    total = r.count;
    return r.data;
  };
  for (;;) {
    const data = read(await page(rows.length, rows.length + size - 1));
    for (const row of data) {
      if (typeof row?.id !== "string" || ids.has(row.id)) throw new Error(`${what} contains duplicate or missing ids`);
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === total) break;
    if (!data.length || rows.length > Number(total)) throw new Error(`${what} evidence is incomplete`);
  }
  // Snapshot check: nothing may have been added or removed since the first page.
  if (read(await page(rows.length, rows.length + size - 1)).length) throw new Error(`${what} changed while it was being read`);
  return rows;
}
