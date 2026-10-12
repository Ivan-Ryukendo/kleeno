import "server-only";
/**
 * Paged reads for calculation inputs (R3.1a/b; rule 14: the engine never sees a partial input set).
 * PostgREST caps a response (default 1,000 rows), so a bare select silently truncates. Pages are keyset pages
 * (`id > last`, ordered by the immutable id), so an update to any other column cannot move a row past the cursor.
 * Each page asks for an exact count of the rows after the cursor: it must equal total minus rows loaded, so an
 * insert/delete behind or ahead of the cursor is seen. Reads that span more than one page are walked twice and the
 * two id lists must match, which also catches a delete+insert swap with an unchanged count. Anything else fails
 * closed: database error, missing/invalid count, duplicate or missing id, empty page that would loop, ceiling.
 * Order rows in memory afterwards when a business order is needed. Limit: row content updated between pages is not
 * detected (ids are); a single REPEATABLE READ RPC would be the upgrade path.
 */
type PageResult<T> = { data: T[] | null; error: { code?: string } | null; count: number | null };
type PageFn<T> = (after: string | null, size: number) => PromiseLike<PageResult<T>>;

export const PAGE_SIZE = 500;
export const MAX_ROWS = 100000;

/** Applies the cursor, the id order and the page size to a filtered select that asked for `{ count: "exact" }`. */
export const keyset = <R, Q extends { gt(column: string, value: string): Q; order(column: string): { limit(n: number): R } }>(query: Q, after: string | null, size: number): R => (after ? query.gt("id", after) : query).order("id").limit(size);

async function pass<T extends { id: string }>(page: PageFn<T>, what: string, size: number, max: number): Promise<T[]> {
  const rows: T[] = [], ids = new Set<string>();
  let total: number | null = null, after: string | null = null;
  for (;;) {
    const r: PageResult<T> = await page(after, size);
    if (r.error) throw new Error(`db ${what} failed${r.error.code ? ` (${r.error.code})` : ""}`);
    if (!r.data || r.count === null || !Number.isSafeInteger(r.count) || r.count < 0) throw new Error(`${what} evidence is incomplete`);
    if (r.count > max) throw new Error(`${what} exceeds the supported size`);
    if (total === null) total = r.count;
    else if (r.count !== total - rows.length) throw new Error(`${what} changed while it was being read`);
    for (const row of r.data) {
      if (typeof row?.id !== "string" || ids.has(row.id)) throw new Error(`${what} contains duplicate or missing ids`);
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === total) return rows;
    if (!r.data.length || rows.length > total) throw new Error(`${what} evidence is incomplete`);
    after = rows[rows.length - 1].id;
  }
}

export async function loadAllRows<T extends { id: string }>(page: PageFn<T>, what: string, opts: { pageSize?: number; max?: number } = {}): Promise<T[]> {
  const size = opts.pageSize ?? PAGE_SIZE, max = opts.max ?? MAX_ROWS;
  const rows = await pass(page, what, size, max);
  if (rows.length <= size) return rows; // one request: the database answered from one snapshot
  const again = await pass(page, what, size, max);
  if (again.length !== rows.length || again.some((row, i) => row.id !== rows[i].id)) throw new Error(`${what} changed while it was being read`);
  return rows;
}
