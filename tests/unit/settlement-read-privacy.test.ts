import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ balance: vi.fn(), from: vi.fn(), tables: [] as string[] }));
vi.mock("@/server/arc/reader", () => ({ usdcBalanceOf: calls.balance, EXPLORER_TX: (hash: string) => hash }));
vi.mock("@/server/db/client", () => ({ db: vi.fn(), must: (result: { data: unknown; error: unknown }) => { if (result.error || result.data == null) throw new Error("read failed"); return result.data; } }));
import { settlementView } from "@/server/db/settlement";

beforeEach(() => { vi.resetAllMocks(); calls.tables = []; calls.balance.mockResolvedValue(123000000n); });
const client = { from: calls.from } as unknown as SupabaseClient;
it("fails closed for omitted roles and OWNER/VIEWER-only readers before any DB or Arc balance call", async () => {
  await expect(settlementView(client, "company", "actor")).rejects.toThrow("Financial reviewer");
  for (const roles of [["OWNER"], ["VIEWER"], ["OWNER", "VIEWER"]] as const) await expect(settlementView(client, "company", "actor", undefined, roles)).rejects.toThrow("Financial reviewer");
  expect(calls.from).not.toHaveBeenCalled(); expect(calls.balance).not.toHaveBeenCalled();
});
it("retains exact financial reader behavior and empty runs for each HR/payroll/payment role", async () => {
  calls.from.mockImplementation((table: string) => {
    calls.tables.push(table);
    const data = table === "companies" ? { name: "Synthetic", live_status: "PROVISIONED", live_payments_enabled: false, guard_address: "guard", per_payment_ceiling: "500000000", is_demo: false, is_sandbox: false } : table === "company_wallets" ? [{ role: "APPROVER", address: "APPROVER-ADDR" }] : [];
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, single: async () => ({ data, error: null }), then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }) }; return q;
  });
  for (const role of ["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] as const) {
    const result = await settlementView(client, "company", "actor", undefined, [role]);
    expect(result.run).toBeNull(); expect(result.balance).toBe("123.00"); expect(result.company.per_payment_ceiling).toBe("500.00");
  }
  expect(calls.tables).toEqual(Array(3).fill(["companies", "company_wallets", "payroll_runs"]).flat());
  expect(calls.balance).toHaveBeenCalledTimes(3);
});
