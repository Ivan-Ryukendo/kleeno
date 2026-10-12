import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

const openJson = vi.hoisted(() => vi.fn(async (_company: string, _table: string, _column: string, _id: string, payload: string) => JSON.parse(payload)));
vi.mock("@/server/crypto", () => ({ openJson }));
vi.mock("@/server/db/client", () => ({ db: () => { throw new Error("privileged database must not be used"); } }));
vi.mock("@/server/db/audit", () => ({ writeAudit: vi.fn() }));
import { workerSummary } from "@/server/db/workers";

const rows = [
  { id: "a", metadata_enc: '{"workerType":"EMPLOYEE"}', wallet_address: "0xAbC", wallet_confirmed_address: "0xabc" },
  { id: "b", metadata_enc: '{"workerType":"CONTRACTOR"}', wallet_address: "0xdef", wallet_confirmed_address: null },
  { id: "c", metadata_enc: null, wallet_address: null, wallet_confirmed_address: null },
  { id: "d", metadata_enc: "{}", wallet_address: "0xaaa", wallet_confirmed_address: "0xbbb" },
];

function reader(count: number | null = rows.length) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query), gt: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, count, error: null }).then(resolve),
  };
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

it("counts active company workers through the supplied reader without reading compensation", async () => {
  openJson.mockClear();
  const { client, from, query } = reader();
  expect(await workerSummary(client, "company")).toEqual({ total: 4, employees: 1, contractors: 1, unspecified: 2, unconfirmedWallets: 2 });
  expect(from.mock.calls).toEqual([["workers"]]);
  expect(query.select).toHaveBeenCalledWith("id, wallet_address, wallet_confirmed_address, metadata_enc", { count: "exact" });
  expect(query.eq.mock.calls).toEqual([["company_id", "company"], ["active", true]]);
  expect(openJson.mock.calls).toEqual(rows.filter(row => row.metadata_enc).map(row => ["company", "workers", "metadata_enc", row.id, row.metadata_enc]));
});

it("rejects an incomplete worker read before decrypting or reporting counts", async () => {
  openJson.mockClear();
  await expect(workerSummary(reader(null).client, "company")).rejects.toThrow("workers evidence is incomplete");
  expect(openJson).not.toHaveBeenCalled();
});
