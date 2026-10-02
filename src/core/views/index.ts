import { z } from "zod";
import { escapeCell } from "../ingest/csv";
import { formatUsdc, parseUsdc } from "../money";
import { hasRole, type Role } from "../tenancy";

// Table views (docs/pages.md section 5). A view is validated DATA against a per-table allow-list of columns and operators (S59):
// never SQL, never a column the table does not define. Filtering, sorting, totals and export run on the server over rows the
// scoped repositories already loaded and decrypted for this role, so encrypted fields are never put into a query.
export type ColType = "text" | "number" | "date" | "enum" | "money";

export interface ColumnDef {
  id: string;
  label: string;
  type: ColType;
  roles?: readonly Role[]; // visible only to these roles (default: everyone in the company)
  values?: readonly string[]; // the choices of an enum column (the filter shows a list)
}
export interface TableDef {
  label: string;
  scope: "company" | "run"; // run tables need a run ID
  columns: ColumnDef[];
  defaults: string[];
  order: string[]; // the stable default order when the view names no sort
  search: string[]; // text columns the search box looks in
  totals: string[]; // money columns summed in the totals row
}

const PAYROLL: readonly Role[] = ["PAYROLL_APPROVER", "HR_APPROVER", "PAYMENT_APPROVER"];
export const MATCH_VALUES = ["AUTO_MATCHED", "MATCHED_AFTER_REVIEW", "EXCEPTION"] as const;

export const TABLES = {
  workers: {
    label: "Workers",
    scope: "company",
    columns: [
      { id: "code", label: "Code", type: "text" },
      { id: "payType", label: "Pay type", type: "enum", values: ["SALARIED", "HOURLY", "RETAINER"] },
      { id: "status", label: "Status", type: "enum", values: ["ACTIVE", "LEFT"] },
      { id: "base", label: "Per period (USDC)", type: "money", roles: PAYROLL },
      { id: "hourly", label: "Hourly rate (USDC)", type: "money", roles: PAYROLL },
      { id: "leftOn", label: "Left on", type: "date" },
    ],
    defaults: ["code", "payType", "status", "base", "hourly"],
    order: ["code"],
    search: ["code"],
    totals: ["base"],
  },
  timesheets: {
    label: "Timesheets",
    scope: "run",
    columns: [
      { id: "worker", label: "Worker", type: "text" },
      { id: "date", label: "Date", type: "date" },
      { id: "hours", label: "Hours", type: "number" },
      { id: "approvedExtra", label: "Approved extra", type: "number" },
      { id: "line", label: "File line", type: "number" },
      { id: "match", label: "Match status", type: "enum", values: MATCH_VALUES },
    ],
    defaults: ["worker", "date", "hours", "approvedExtra", "match"],
    order: ["worker", "date", "line"],
    search: ["worker"],
    totals: [],
  },
  leave: {
    label: "Leave",
    scope: "run",
    columns: [
      { id: "worker", label: "Worker", type: "text" },
      { id: "date", label: "Date", type: "date" },
      { id: "leaveType", label: "Type", type: "enum", values: ["PAID", "UNPAID"] },
      { id: "hours", label: "Hours", type: "number" },
      { id: "line", label: "File line", type: "number" },
      { id: "match", label: "Match status", type: "enum", values: MATCH_VALUES },
    ],
    defaults: ["worker", "date", "leaveType", "hours", "match"],
    order: ["worker", "date", "line"],
    search: ["worker"],
    totals: [],
  },
  exceptions: {
    label: "Exceptions",
    scope: "run",
    columns: [
      { id: "worker", label: "Worker", type: "text" },
      { id: "category", label: "Category", type: "enum", values: ["DUPLICATE_TIMESHEET", "LEAVE_WORK_CONFLICT", "UNAPPROVED_OVERTIME", "UNEXPLAINED_MISSING_HOURS"] },
      { id: "severity", label: "Severity", type: "enum", values: ["LOW", "MEDIUM", "HIGH"] },
      { id: "status", label: "Status", type: "enum", values: ["OPEN", "IN_REVIEW", "RESOLVED", "ESCALATED"] },
      { id: "detail", label: "What was found", type: "text" },
      { id: "decision", label: "Decision", type: "enum" },
      { id: "suggestion", label: "AI suggestion (not applied)", type: "enum" },
      { id: "raised", label: "Raised", type: "date" },
    ],
    defaults: ["worker", "category", "status", "detail", "decision"],
    order: ["raised", "worker", "category"],
    search: ["worker", "detail"],
    totals: [],
  },
  lines: {
    label: "Pay lines",
    scope: "run",
    columns: [
      { id: "worker", label: "Worker", type: "text" },
      { id: "gross", label: "Gross (USDC)", type: "money" },
      { id: "deductions", label: "Deductions (USDC)", type: "money" },
      { id: "net", label: "Net (USDC)", type: "money" },
      { id: "paid", label: "Actually paid (USDC)", type: "money" },
    ],
    defaults: ["worker", "gross", "deductions", "net", "paid"],
    order: ["worker"],
    search: ["worker"],
    totals: ["gross", "deductions", "net", "paid"],
  },
} as const satisfies Record<string, TableDef>;
export type TableId = keyof typeof TABLES;
export const TABLE_IDS = Object.keys(TABLES) as [TableId, ...TableId[]];

export const OPS: Record<ColType, readonly string[]> = {
  text: ["contains", "equals"],
  enum: ["is", "isNot"],
  number: ["eq", "gt", "gte", "lt", "lte"],
  money: ["eq", "gt", "gte", "lt", "lte"],
  date: ["on", "before", "after"],
};
export const ALL_OPS = [...new Set(Object.values(OPS).flat())] as [string, ...string[]];

export const ViewSchema = z
  .object({
    table: z.enum(TABLE_IDS),
    columns: z.array(z.string().max(30)).min(1).max(30),
    filters: z.array(z.object({ column: z.string().max(30), op: z.enum(ALL_OPS), value: z.string().max(200) }).strict()).max(8),
    sort: z.object({ column: z.string().max(30), dir: z.enum(["asc", "desc"]) }).strict().nullable(),
    search: z.string().max(100),
  })
  .strict();
export type ViewDef = z.infer<typeof ViewSchema>;

export interface TableResult {
  columns: ColumnDef[]; // the columns shown, in order, already limited to what the role may see
  rows: Row[];
  total: number; // rows matching the view (rows may be capped)
  totals: Record<string, string>;
  truncated: boolean;
}

export class ViewError extends Error {}

export const columnsFor = (table: TableId, roles: readonly Role[]): ColumnDef[] => (TABLES[table].columns as readonly ColumnDef[]).filter((c) => !c.roles || hasRole(roles, ...c.roles));
export const defaultView = (table: TableId, roles: readonly Role[]): ViewDef => ({ table, columns: TABLES[table].defaults.filter((id) => columnsFor(table, roles).some((c) => c.id === id)), filters: [], sort: null, search: "" });

/** The allow-list check (S59). Throws on any column the role cannot see, an operator the column type does not have, or an unparsable value. */
export function validateView(def: ViewDef, roles: readonly Role[]): ViewDef {
  const cols = new Map(columnsFor(def.table, roles).map((c) => [c.id, c]));
  const known = (id: string) => cols.get(id) ?? (() => { throw new ViewError(`unknown column: ${id}`); })();
  def.columns.forEach(known);
  for (const f of def.filters) {
    const c = known(f.column);
    if (!OPS[c.type].includes(f.op)) throw new ViewError(`${f.op} does not apply to ${c.label}`);
    checkValue(c.type, f.value);
  }
  if (def.sort) known(def.sort.column);
  return def;
}

export type Row = Record<string, string | number | null>;

/** Comparable form of a cell or a filter value: money and numbers as exact scaled integers, dates as text, the rest lower-cased text. */
function norm(type: ColType, v: string | number | null): bigint | string {
  const s = v === null ? "" : String(v).trim();
  if (type === "money" || type === "number") return s === "" ? -1n : parseUsdc(s); // blank sorts first
  return type === "date" ? s : s.toLowerCase();
}

function checkValue(type: ColType, v: string) {
  if ((type === "money" || type === "number") && !/^\d+(\.\d{1,6})?$/.test(v.trim())) throw new ViewError(type === "money" ? "amount filters need a number like 1200.50" : "number filters need a number like 8.5");
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) throw new ViewError("date filters need YYYY-MM-DD");
}

function matches(type: ColType, cell: string | number | null, op: string, raw: string): boolean {
  const have = norm(type, cell);
  const want = norm(type, raw);
  switch (op) {
    case "contains": return String(have).includes(String(want));
    case "equals": case "is": case "on": case "eq": return have === want;
    case "isNot": return have !== want;
    case "gt": case "after": return have > want;
    case "gte": return have >= want;
    case "lt": case "before": return have < want;
    case "lte": return have <= want;
    default: return false;
  }
}

/** Search, filter and sort. Pure: the same rows and view always give the same result. */
export function applyView(rows: Row[], def: ViewDef): Row[] {
  const t = TABLES[def.table] as TableDef;
  const type = (id: string) => (t.columns.find((c) => c.id === id) as ColumnDef).type;
  const q = def.search.trim().toLowerCase();
  const out = rows.filter((r) => (!q || t.search.some((id) => String(r[id] ?? "").toLowerCase().includes(q))) && def.filters.every((f) => matches(type(f.column), r[f.column] ?? null, f.op, f.value)));
  const keys = def.sort ? [{ column: def.sort.column, sign: def.sort.dir === "asc" ? 1 : -1 }, ...t.order.map((column) => ({ column, sign: 1 }))] : t.order.map((column) => ({ column, sign: 1 }));
  return [...out].sort((a, b) => {
    for (const { column, sign } of keys) {
      const x = norm(type(column), a[column] ?? null);
      const y = norm(type(column), b[column] ?? null);
      if (x !== y) return (x < y ? -1 : 1) * sign;
    }
    return 0;
  });
}

/** Exact sums of the money columns shown, over the rows the view shows (never estimated). */
export function totalsFor(rows: Row[], def: ViewDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of (TABLES[def.table] as TableDef).totals) if (def.columns.includes(id)) out[id] = formatUsdc(rows.reduce((s, r) => s + (r[id] === null || r[id] === undefined || r[id] === "" ? 0n : parseUsdc(String(r[id]))), 0n));
  return out;
}

/** CSV of the view: only the columns the role may see, every cell escaped against spreadsheet formulas (S25, S60). */
export function toCsv(rows: Row[], def: ViewDef, roles: readonly Role[]): string {
  const cols = columnsFor(def.table, roles).filter((c) => def.columns.includes(c.id));
  const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [cols.map((c) => quote(escapeCell(c.label))).join(","), ...rows.map((r) => cols.map((c) => quote(escapeCell(String(r[c.id] ?? "")))).join(","))].join("\r\n") + "\r\n";
}
