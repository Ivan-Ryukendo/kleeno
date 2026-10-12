import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db/client", () => ({ db: vi.fn(), must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ openJson: vi.fn(), sealJson: vi.fn() }));
vi.mock("@/server/arc/reader", () => ({ EXPLORER_TX: (hash: string) => `https://testnet.arcscan.app/tx/${hash}` }));
import { periodSteps, periodView, workerHistoryView } from "@/server/db/views";
import { auditView, safeAuditRefs } from "@/server/db/audit";
import { reorderColumns } from "@/components/table-view";
import type { SupabaseClient } from "@supabase/supabase-js";

const runId = "c3b64b32-7f23-4a64-8993-9b4ef2151c63";
type Fixture = Record<string, unknown>;
function reader(tables: Record<string, Fixture[]>, serverCap = Infinity, failedTable?: string, failedCode = "READ_UNAVAILABLE") {
  const reads: { table: string; filters: [string, unknown][]; select: string; or: string[] }[] = [];
  const client = { from(table: string) {
    const read = { table, filters: [] as [string, unknown][], select: "", or: [] as string[] }; reads.push(read);
    let single = false, max = Infinity;
    const query = {
      select(columns: string) { read.select = columns; return query; },
      eq(key: string, value: unknown) { read.filters.push([key, value]); return query; },
      in() { return query; }, order() { return query; },
      limit(value: number) { max = value; return query; },
      maybeSingle() { single = true; return query; },
      or(value: string) { read.or.push(value); return query; },
      then(resolve: (value: unknown) => unknown) { if (table === failedTable) return Promise.resolve(resolve({ data: null, error: { code: failedCode }, count: null })); const sources: Record<string, string> = { worker_directory: "workers", obligation_metadata: "obligations", payment_batch_metadata: "payment_batches", calculation_line_metadata: "calculation_lines" }; const matched = (tables[table] ?? tables[sources[table] ?? table] ?? []).filter((row) => read.filters.every(([key, value]) => row[key] === value)); return Promise.resolve(resolve({ data: single ? matched[0] ?? null : matched.slice(0, Math.min(max, serverCap)), error: null, count: matched.length })); },
    }; return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

describe("period progress follows recorded workflow", () => {
  it("blocks reconciliation when recorded exceptions remain open", () => {
    const steps = periodSteps("EXCEPTIONS_PENDING", "SIMULATION", 3, true);
    expect(steps.find((s) => s.label === "Exceptions")).toMatchObject({ state: "blocked", detail: "3 open" });
    expect(steps.filter((s) => s.state === "done").map((s) => s.label)).toEqual(["Policy", "Import"]);
  });
  it("simulation ends at validated calculation and has no payment links", () => {
    const steps = periodSteps("CALCULATION_VALIDATED", "SIMULATION", 0, true);
    expect(steps.find((s) => s.label === "Calculation")?.state).toBe("done");
    expect(steps.slice(-2).map((s) => s.state)).toEqual(["unavailable", "unavailable"]);
  });
  it("a rejected run and a payment failure are blocked, never shown as complete", () => {
    expect(periodSteps("REJECTED", "LIVE_TESTNET", 0, true)[4].state).toBe("blocked");
    expect(periodSteps("PAYMENT_FAILED", "LIVE_TESTNET", 0, true)[5].state).toBe("blocked");
    expect(periodSteps("RECONCILED", "LIVE_TESTNET", 0, true).every((s) => s.state === "done")).toBe(true);
  });
  it("a disabled company blocks unsettled live payments only", () => {
    expect(periodSteps("OBLIGATIONS_CREATED", "LIVE_TESTNET", 0, false)[5]).toMatchObject({ state: "blocked", detail: "Live payments are off" });
    expect(periodSteps("RECONCILED", "LIVE_TESTNET", 0, false)[5].state).toBe("done");
  });
});

describe("audit disclosure", () => {
  it("exposes safe references, never raw payroll, notes, prompts or arbitrary string values", () => {
    expect(safeAuditRefs({ runId: "c3b64b32-7f23-4a64-8993-9b4ef2151c63", from: "DRAFT", to: "DATA_IMPORTED", rows: 4, amount: "950", prompt: "private", note: "private", status: "employee name", calculationHash: "a".repeat(64) })).toEqual({ runId: "c3b64b32-7f23-4a64-8993-9b4ef2151c63", from: "DRAFT", to: "DATA_IMPORTED", rows: 4, calculationHash: "a".repeat(64) });
  });
  it("same-time events retain an ID tie-breaker in the older-events cursor", async () => {
    const { client, reads } = reader({ audit_events: [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, company_id: "company", event: "run.create", entity_type: "run", entity_id: runId, actor: "system", actor_type: "system", correlation_id: null, refs: {}, created_at: "2026-10-05T10:00:00.000Z" })) });
    const first = await auditView(client, "company", { limit: 1 });
    expect(first.next).toBe("2026-10-05T10:00:00.000Z~00000000-0000-4000-8000-000000000001");
    await auditView(client, "company", { before: first.next! });
    expect(reads.at(-1)?.or[0]).toContain("and(created_at.eq.2026-10-05T10:00:00.000Z,id.lt.00000000-0000-4000-8000-000000000001)");
  });
});

describe("workspace read boundaries", () => {
  it("a failed directory read is unavailable rather than a missing worker", async () => {
    const { client, reads } = reader({}, Infinity, "worker_directory");
    await expect(workerHistoryView(client, "company", runId, ["VIEWER"])).rejects.toThrow("worker history read failed");
    expect(reads.map(read => read.table)).toEqual(["worker_directory"]);
  });
  it("a failed linked-run read cannot appear as an empty audit timeline", async () => {
    const { client, reads } = reader({}, Infinity, "payroll_runs");
    await expect(auditView(client, "company", { runId })).rejects.toThrow("audit run read failed");
    expect(reads.map(read => read.table)).toEqual(["payroll_runs"]);
  });
  it("unknown and cross-company run/worker IDs reveal no history and trigger no dependent reads", async () => {
    const { client, reads } = reader({ payroll_runs: [{ id: runId, company_id: "other" }], workers: [{ id: runId, company_id: "other" }] });
    expect(await periodView(client, { companyId: "company", userId: "user", roles: ["VIEWER"] }, runId)).toBeNull();
    expect(await workerHistoryView(client, "company", runId, ["VIEWER"])).toBeNull();
    expect(reads.map((r) => r.table)).toEqual(["payroll_runs", "worker_directory"]);
  });
  it("imported records are not called automatically matched before reconciliation; money is role limited", async () => {
    const { client, reads } = reader({ payroll_runs: [{ id: runId, company_id: "company", status: "DATA_IMPORTED", config_version: 1 }], timesheets: [{ id: "record", worker_id: "worker", run_id: runId, company_id: "company" }], calculations: [{ id: "calc", run_id: runId, company_id: "company" }], calculation_lines: [{ worker_id: "worker", calculation_id: "calc", company_id: "company", net: "1000000" }] });
    const result = await periodView(client, { companyId: "company", userId: "user", roles: ["VIEWER"] }, runId);
    expect(result).toMatchObject({ workers: 1, autoMatched: null, netTotal: null, openExceptions: 0 });
    expect(reads.find(r => r.table === "calculation_line_metadata")?.select).toBe("worker_id");
    expect(reads.some(r => ["workers", "calculation_lines", "obligations", "payment_batches"].includes(r.table))).toBe(false);
    expect(reads.every((r) => r.filters.some(([key, value]) => key === "company_id" && value === "company"))).toBe(true);
  });
  it("a bounded partial input read never produces invented full-run worker or match totals", async () => {
    const { client } = reader({ payroll_runs: [{ id: runId, company_id: "company", status: "READY_FOR_CALCULATION", config_version: 1 }], timesheets: Array.from({ length: 2001 }, (_, i) => ({ id: `record${i}`, worker_id: `worker${i}`, run_id: runId, company_id: "company" })) });
    expect(await periodView(client, { companyId: "company", userId: "user", roles: ["HR_APPROVER"] }, runId)).toMatchObject({ workers: null, autoMatched: null, netTotal: null });
  });
  it("does not mistake a lower server row cap for complete period facts", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `record${i}`, worker_id: `worker${i}`, run_id: runId, calculation_id: "calc", company_id: "company", net: "1000000", status: "SETTLED" }));
    const { client } = reader({ payroll_runs: [{ id: runId, company_id: "company", status: "CALCULATION_VALIDATED" }], calculations: [{ id: "calc", run_id: runId, company_id: "company" }], timesheets: rows, calculation_lines: rows, obligations: rows }, 1000);
    expect(await periodView(client, { companyId: "company", userId: "user", roles: ["HR_APPROVER"] }, runId)).toMatchObject({ workers: null, autoMatched: null, netTotal: null, settled: null, obligations: null });
  });
});

describe("drag and keyboard ordering use the same operation", () => {
  it("moves either direction without dropping or duplicating columns", () => {
    expect(reorderColumns(["code", "base", "status"], "status", "code")).toEqual(["status", "code", "base"]);
    expect(reorderColumns(["code", "base", "status"], "code", "status")).toEqual(["base", "status", "code"]);
    expect(reorderColumns(["code", "base"], "missing", "base")).toEqual(["code", "base"]);
  });
});


describe("missing audit schema on the dashboard", () => {
  it.each(["obligation_metadata", "payment_batch_metadata"])("keeps financial period facts available when %s is absent, without claiming an empty audit", async table => {
    const { client } = reader({ payroll_runs: [{ id: runId, company_id: "company", status: "DRAFT", config_version: 1 }] }, Infinity, table, "PGRST205");
    await expect(auditView(client, "company", { runId })).rejects.toThrow();
    const result = await periodView(client, { companyId: "company", userId: "user", roles: ["HR_APPROVER"] }, runId);
    expect(result?.activity).toMatchObject({ unavailable: true, items: [], next: null });
    expect(result?.canSign).toBe(false);
  });
  it("does not turn failed required financial reads into zero totals", async () => {
    const { client } = reader({ payroll_runs: [{ id: runId, company_id: "company", status: "DRAFT", config_version: 1 }] }, Infinity, "obligations", "PGRST205");
    await expect(periodView(client, { companyId: "company", userId: "user", roles: ["HR_APPROVER"] }, runId)).rejects.toThrow();
  });
});
