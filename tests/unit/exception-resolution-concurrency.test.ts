import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "IN_REVIEW", action: null as string | null, note: null as string | null,
  audit: [] as { action: string }[], writes: 0, firstSaved: () => {}, secondSaved: () => {},
  firstContinue: Promise.resolve(), secondContinue: Promise.resolve(), rpc: vi.fn() }));
vi.mock("@/server/crypto", () => ({ sealField: async (_c: string, _t: string, _f: string, _id: string, value: string) => `encrypted:${value}` }));
vi.mock("@/server/db/configs", () => ({ loadConfig: async () => ({ config: {} }) }));
vi.mock("@/server/db/workers", () => ({ listWorkers: async () => [] }));
vi.mock("@/server/ai/recon", () => ({ suggestForExceptions: vi.fn() }));
vi.mock("@/core/reconciliation", async original => ({ ...await original<object>(), analyse: () => ({ exceptions: [] }) }));
vi.mock("@/server/db/paged", () => ({ keyset: (q: unknown) => q, loadAllRows: async () => [] }));
vi.mock("@/server/db/store", () => ({ dbStore: () => ({
  load: async () => state.status,
  cas: async (_id: string, _company: string, from: string, to: string, audit: { refs: { action: string } }) => {
    if (state.status !== from) return false;
    state.status = to; state.audit.push(audit.refs); return true;
  },
}) }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: state.rpc, from: (table: string) => {
  let payload: { resolution_action: string; resolution: string } | null = null;
  const query = { select: () => query, eq: () => query,
    update: (value: typeof payload) => { payload = value; return query; },
    maybeSingle: async () => ({ data: table === "exceptions" ? { id: "exception", run_id: "run", category: "DUPLICATE_TIMESHEET", status: state.status, options: ["KEEP_FIRST", "KEEP_LATEST"] } : { id: "run", status: "DRAFT", config_version: 1 }, error: null }),
    then: async (resolve: (value: unknown) => unknown) => {
      if (!payload || state.status !== "IN_REVIEW") return resolve({ data: [], error: null });
      state.action = payload.resolution_action; state.note = payload.resolution;
      if (++state.writes === 1) { state.firstSaved(); await state.firstContinue; }
      else { state.secondSaved(); await state.secondContinue; }
      return resolve({ data: [{ id: "exception" }], error: null });
    },
  }; return query;
} }), must: (r: { data: unknown; error: unknown }) => { if (r.error) throw new Error("database unavailable"); return r.data; } }));
import { resolveException } from "@/server/db/reconciliation";

beforeEach(() => {
  state.status = "IN_REVIEW"; state.action = null; state.note = null; state.audit = []; state.writes = 0; vi.clearAllMocks();
  // This models response ordering only; real lock, grants and transaction acceptance belongs to DB tests.
  state.rpc.mockImplementation(async (_name, params) => {
    if (state.status !== "IN_REVIEW") { state.secondSaved(); return { data: "STALE_STATE", error: null }; }
    state.action = params.p_action; state.note = params.p_resolution; state.status = "RESOLVED";
    state.audit.push({ action: params.p_action }); state.firstSaved(); await state.firstContinue;
    return { data: "OK", error: null };
  });
});

it("the winning resolution audit and encrypted decision belong to the same command", async () => {
  let continueA!: () => void, continueB!: () => void;
  state.firstContinue = new Promise<void>(r => { continueA = r; }); state.secondContinue = new Promise<void>(r => { continueB = r; });
  const firstSaved = new Promise<void>(r => { state.firstSaved = r; });
  const secondSaved = new Promise<void>(r => { state.secondSaved = r; });
  const who = { companyId: "company", userId: "user", roles: ["PAYROLL_APPROVER"] as const, correlationId: "request" };
  const outcome = (command: ReturnType<typeof resolveException>) => command.then(() => "OK", error => error.code ?? "UNEXPECTED_ERROR");
  const a = outcome(resolveException(who, "exception", { action: "KEEP_FIRST", note: "first decision" }));
  await firstSaved;
  const b = outcome(resolveException(who, "exception", { action: "KEEP_LATEST", note: "later decision" }));
  await secondSaved; continueA();
  const resultA = await a; continueB();
  expect([resultA, await b].sort()).toEqual(["OK", "STALE_STATE"]);
  expect(state.status).toBe("RESOLVED");
  expect(state.audit).toHaveLength(1);
  expect(state.action).toBe(state.audit[0].action);
  expect(state.note).toBe(`encrypted:${state.action === "KEEP_FIRST" ? "first decision" : "later decision"}`);
});

it.each(["FORBIDDEN", "NOT_FOUND", "STALE_STATE"])("fails closed on resolution %s without changing human evidence", async code => {
  state.rpc.mockResolvedValue({ data: code, error: null });
  await expect(resolveException({ companyId: "company", userId: "user", roles: ["PAYROLL_APPROVER"] }, "exception", { action: "KEEP_FIRST", note: "reviewed decision" })).rejects.toMatchObject({ code });
  expect(state.status).toBe("IN_REVIEW"); expect(state.action).toBeNull(); expect(state.audit).toEqual([]);
});
