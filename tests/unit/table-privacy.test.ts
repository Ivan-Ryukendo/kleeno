import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/core/tenancy";
vi.mock("@/server/db/client", () => ({ must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ openField: vi.fn(async () => "1000000") }));
vi.mock("@/server/db/calculations", () => ({ loadLines: vi.fn(async () => [{ id: "line", workerId: "worker", gross: 1000000n, deductions: 0n, net: 1000000n }]) }));
vi.mock("@/server/db/workers", () => ({ listWorkers: vi.fn(async () => [{ id: "worker", pseudonym: "W001", payType: "HOURLY", active: true, compensation: { baseAmount: 1000000n, hourlyRate: 1000000n }, leftOn: null }]) }));
vi.mock("@/server/db/resources", () => ({ resourceColumns: vi.fn(async () => []), resourceColumnDef: vi.fn(), latestResourceInputs: vi.fn() }));
vi.mock("@/server/db/reconciliation", () => ({ flaggedRecords: vi.fn(), listExceptions: vi.fn() }));
import { openField } from "@/server/crypto";
import { loadLines } from "@/server/db/calculations";
import { listWorkers } from "@/server/db/workers";
import { defaultView } from "@/core/views";
import { loadTableRows, queryTable } from "@/server/db/table-views";
import { authorizeCell } from "@/server/db/table-workspace";

function reader(failedTable?: string) {
  const reads: { table: string; columns: string }[] = [];
  const client = { from(table: string) {
    const read = { table, columns: "" }; reads.push(read);
    const rows = ["workers", "worker_directory"].includes(table) ? [{ id: "worker", pseudonym: "W001", pay_type: "HOURLY", active: true, left_on: null }]
      : ["calculation_lines", "calculation_line_metadata"].includes(table) ? [{ id: "line", worker_id: "worker", calculation_id: "calc" }]
      : table === "actual_payments" ? [{ id: "paid", worker_id: "worker", amount_enc: "encrypted" }] : [];
    const query = {
      select(columns: string) { read.columns = columns; return query; },
      eq() { return query; }, order() { return query; }, limit() { return query; },
      maybeSingle: async () => ({ data: rows[0] ?? { id: table === "calculations" ? "calc" : "run" }, error: table === failedTable ? { message: "synthetic unavailable" } : null }),
      then(resolve: (r: unknown) => unknown) { return Promise.resolve(resolve({ data: rows, count: rows.length, error: null })); },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}
beforeEach(() => vi.clearAllMocks());

it.each([{ roles: [] as Role[] }, { roles: ["VIEWER"] as Role[] }, { roles: ["OWNER"] as Role[] }])("with roles $roles worker views never load compensation or metadata", async ({ roles }) => {
  const { client, reads } = reader();
  const result = await queryTable(client, "company", roles, defaultView("workers", roles), null);
  expect(result.rows).toEqual([{ code: "W001", payType: "HOURLY", status: "ACTIVE" }]);
  expect(listWorkers).not.toHaveBeenCalled();
  expect(reads.every(r => r.table === "worker_directory" && !/wallet|metadata|payload|compensation/.test(r.columns))).toBe(true);
});

it.each([{ roles: [] as Role[] }, { roles: ["VIEWER"] as Role[] }, { roles: ["OWNER"] as Role[] }])("with roles $roles pay-line queries and exports never read financial data", async ({ roles }) => {
  const { client, reads } = reader();
  const result = await queryTable(client, "company", roles, defaultView("lines", roles), "run", { all: true });
  expect(result.rows).toEqual([{ worker: "W001" }]);
  expect(result.availableColumns?.map(c => c.id)).toEqual(["worker"]);
  expect(result.totals).toEqual({});
  expect(loadLines).not.toHaveBeenCalled();
  expect(openField).not.toHaveBeenCalled();
  expect(reads.some(r => r.table === "actual_payments")).toBe(false);
  expect(reads.find(r => r.table === "calculation_line_metadata")?.columns).toBe("id, worker_id");
  expect(reads.some(r => ["workers", "calculation_lines", "obligations", "payment_batches"].includes(r.table))).toBe(false);
});

it("direct row reads default to no financial authority", async () => {
  const { client } = reader();
  expect(await loadTableRows(client, "company", "workers", null)).toEqual([{ __rowId: "worker", code: "W001", payType: "HOURLY", status: "ACTIVE", leftOn: null }]);
  expect(listWorkers).not.toHaveBeenCalled();
});

it.each(["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] as Role[])("%s retains exact pay-line access", async (role) => {
  const { client } = reader();
  const result = await queryTable(client, "company", [role], defaultView("lines", [role]), "run");
  expect(result.rows[0]).toEqual({ worker: "W001", gross: "1.00", deductions: "0.00", net: "1.00", paid: "1.00" });
  expect(loadLines).toHaveBeenCalled();
  expect(openField).toHaveBeenCalled();
});

it("rejects restricted pay filters before any data read", async () => {
  const { client, reads } = reader();
  const view = { ...defaultView("lines", ["VIEWER"]), filters: [{ column: "net", op: "gt", value: "1" }] };
  await expect(queryTable(client, "company", ["VIEWER"], view, "run")).rejects.toThrow("unknown column");
  expect(reads).toHaveLength(0);
});

it.each(["payroll_runs", "calculations"])("failed %s read cannot appear as an empty table", async (table) => {
  const { client } = reader(table);
  await expect(queryTable(client, "company", ["HR_APPROVER"], defaultView("lines", ["HR_APPROVER"]), "run")).rejects.toThrow("read unavailable");
  expect(loadLines).not.toHaveBeenCalled();
});

it.each(["workers", "lines"] as const)("VIEWER cell comments in %s authorize through safe metadata", async (table) => {
  const { client, reads } = reader();
  await authorizeCell(client, "company", ["VIEWER"], { table, rowId: table === "workers" ? "worker" : "line", columnId: table === "workers" ? "code" : "worker", runId: table === "workers" ? null : "run" });
  expect(reads[0].table).toBe(table === "workers" ? "worker_directory" : "calculation_line_metadata");
  expect(reads.some(r => ["workers", "calculation_lines"].includes(r.table))).toBe(false);
});

it("VIEWER cannot open a thread on a financial pay-line column", async () => {
  const { client, reads } = reader();
  await expect(authorizeCell(client, "company", ["VIEWER"], { table: "lines", rowId: "line", columnId: "net", runId: "run" })).rejects.toThrow("column unavailable");
  expect(reads).toHaveLength(0);
});
