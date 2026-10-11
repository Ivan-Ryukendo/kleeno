import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const calls = vi.hoisted(() => ({ imports: vi.fn(), policy: vi.fn(), log: vi.fn() }));
vi.mock("@/server/auth/session", () => ({
  AuthError: class extends Error {}, jarFromRequest: () => [], authenticateUser: vi.fn(),
  authenticate: async () => ({ actor: { userId: "user", companyId: "company", roles: ["PAYROLL_APPROVER"] }, client: {} }),
}));
vi.mock("@/server/auth/admin", () => ({ authenticateAdmin: vi.fn() }));
vi.mock("@/server/site", () => ({ siteMode: () => "app", adminGateOk: () => true }));
vi.mock("@/server/log", () => ({ logError: calls.log }));
vi.mock("@/server/db/imports", () => ({ importRows: calls.imports }));
vi.mock("@/server/ai/policy", () => ({ proposeConfig: calls.policy }));
import { guarded } from "@/server/auth/guard";
import { POST as importRoute } from "@/app/api/imports/route";
import { POST as policyRoute } from "@/app/api/configs/route";
import { CSV_LIMITS } from "@/core/ingest/csv";
import { createHash } from "node:crypto";

const imports = { runId: "11111111-1111-4111-8111-111111111111", type: "TIMESHEETS", mapping: { workerRef: 0, date: 1, hours: 2 }, items: [{ row: 2, data: { workerRef: "W001", date: "2026-10-01", hours: "8" } }] };
const request = (body?: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/test", { method: "POST", headers: { origin: "http://localhost", ...headers }, body });
const text = (value: unknown) => JSON.stringify(value);
beforeEach(() => { vi.clearAllMocks(); calls.imports.mockResolvedValue({ rows: 1 }); calls.policy.mockResolvedValue({ status: "ACCEPTED" }); });

it("stops a multi-chunk import over the normalized JSON budget before repository work, despite a false length header", async () => {
  let pulls = 0; const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; if (pulls === 42) controller.close(); else controller.enqueue(new Uint8Array(256 * 1024).fill(32)); }, cancel: cancelled }, { highWaterMark: 0 });
  const r = new Request("http://localhost/api/imports", { method: "POST", headers: { origin: "http://localhost", "content-length": "1" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  const response = await importRoute(r);
  expect(response.status).toBe(413); expect(pulls).toBe(41); expect(cancelled).toHaveBeenCalledOnce();
  expect((await response.json()).error).toMatchObject({ code: "TOO_LARGE", message: expect.stringContaining("split rows by period") });
  expect(calls.imports).not.toHaveBeenCalled(); expect(calls.policy).not.toHaveBeenCalled();
});

it("refuses oversized declared policy requests and absent-length bodies before AI or database work", async () => {
  for (const r of [request(text({ policyText: "valid" }), { "content-length": String(1024 * 1024 + 1) }), request(" ".repeat(1024 * 1024) + text({ policyText: "valid" }))]) {
    expect((await policyRoute(r)).status).toBe(413);
  }
  expect(calls.policy).not.toHaveBeenCalled(); expect(calls.imports).not.toHaveBeenCalled();
});

it("counts actual UTF-8 bytes, accepts the exact cap across split code points, and rejects one extra byte", async () => {
  const raw = text({ value: "é" }); const bytes = new TextEncoder().encode(raw), handler = vi.fn(async ({ body }: { body: { value: string } }) => ({ value: body.value }));
  const route = guarded({ body: z.object({ value: z.string() }).strict(), maxBodyBytes: bytes.length }, handler);
  const split = bytes.indexOf(0xc3) + 1;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); } });
  const r = new Request("http://localhost/api/test", { method: "POST", headers: { origin: "http://localhost" }, body, duplex: "half" } as RequestInit & { duplex: "half" });
  expect((await route(r)).status).toBe(200); expect(handler.mock.calls[0][0].body).toEqual({ value: "é" });
  expect((await route(request(raw + " "))).status).toBe(413); expect(handler).toHaveBeenCalledOnce();
  expect((await route(request())).status).toBe(400);
});

it("cancels and releases a failed reader without invoking the handler", async () => {
  const reader = { read: vi.fn().mockRejectedValue(new Error("PRIVATE-STREAM-CANARY")), cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() };
  const r = request("{}"); vi.spyOn(r.body!, "getReader").mockReturnValue(reader as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
  const handler = vi.fn(async () => ({}));
  const response = await guarded({ body: z.object({}), maxBodyBytes: 100 }, handler)(r);
  expect(response.status).toBe(500); expect(reader.cancel).toHaveBeenCalledOnce(); expect(reader.releaseLock).toHaveBeenCalledOnce();
  expect(handler).not.toHaveBeenCalled(); expect(await response.text()).not.toContain("PRIVATE-STREAM-CANARY");
});

it("accepts maximum mapped row count and rejects excess rows or columns before repository work", async () => {
  const max = { ...imports, items: Array.from({ length: CSV_LIMITS.rows }, (_, i) => ({ ...imports.items[0], row: i + 2 })) };
  expect((await importRoute(request(text(max)))).status).toBe(200);
  calls.imports.mockClear();
  const tooWide = { ...imports, items: [{ row: 2, data: Object.fromEntries(Array.from({ length: CSV_LIMITS.columns + 1 }, (_, i) => [`field${i}`, "1"])) }] };
  for (const input of [{ ...max, items: [...max.items, { ...imports.items[0], row: 2 }] }, tooWide]) {
    const response = await importRoute(request(text(input))); expect(response.status).toBe(400);
    if (input !== tooWide) expect((await response.json()).error.message).toContain("maximum 10000");
  }
  expect(calls.imports).not.toHaveBeenCalled();
});

it("refuses an unknown mapped field and aggregate policy clause overflow before repository/provider work", async () => {
  expect((await importRoute(request(text({ ...imports, mapping: { ...imports.mapping, unknown: 3 } })))).status).toBe(400);
  const documents = Array.from({ length: 2 }, (_, i) => ({ id: `11111111-1111-4111-8111-11111111111${i}`, format: "txt", contentHash: "a".repeat(64), clauses: Array.from({ length: 251 }, (_, j) => ({ id: `C${i}-${j}`, text: "x", anchor: `paragraph:${j + 1}` })) }));
  expect((await policyRoute(request(text({ policyText: "x", documents })))).status).toBe(400);
  expect(calls.imports).not.toHaveBeenCalled(); expect(calls.policy).not.toHaveBeenCalled();
});

it("keeps the maximum policy provenance shape within its independent JSON budget, including UTF-8 and JSON escaping", async () => {
  const documents = Array.from({ length: 10 }, (_, i) => {
    const clauses = Array.from({ length: 50 }, (_, j) => ({ id: `C${i}-${j}-` + "界".repeat(70), text: "\u0001".repeat(79), anchor: "paragraph:" + "1".repeat(70) }));
    return { id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`, format: "txt", contentHash: createHash("sha256").update(clauses.map(c => c.text).join("\n")).digest("hex"), clauses };
  });
  const input = { policyText: documents.flatMap(d => d.clauses.map(c => c.text)).join("\n"), documents };
  expect(input.policyText.length).toBe(39999); expect(new TextEncoder().encode(text(input)).length).toBeLessThan(1024 * 1024);
  expect((await policyRoute(request(text(input)))).status).toBe(200); expect(calls.policy).toHaveBeenCalledOnce();
  calls.policy.mockClear();
  const tooLong = { ...input, documents: documents.map(d => ({ ...d, clauses: d.clauses.map(c => ({ ...c, text: c.text + "xx" })) })) };
  expect((await policyRoute(request(text(tooLong)))).status).toBe(400); expect(calls.policy).not.toHaveBeenCalled();
});

it("accepts a UTF-8 BOM-prefixed JSON body like request.text() does", async () => {
  const response = await importRoute(request("\uFEFF" + text(imports)));
  expect(response.status).toBe(200); expect(calls.imports).toHaveBeenCalledOnce();
});
