import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payType: "SALARIED", versions: [{ version: 1, payload_enc: "initial" }],
  audit: [] as { event: string; refs: Record<string, unknown> }[],
  inserted: () => {}, continueFirst: Promise.resolve(), rpc: vi.fn(),
}));
vi.mock("@/server/crypto", () => ({ sealJson: async (_company: string, _table: string, _column: string, _id: string, payload: unknown) => JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value) }));
vi.mock("@/server/db/audit", () => ({ writeAudit: async (event: { event: string; refs: Record<string, unknown> }) => {
  state.audit.push(event);
  if (event.event === "compensation.version" && event.refs.version === 2) {
    state.inserted(); await state.continueFirst;
  }
} }));
vi.mock("@/server/db/client", () => ({ db: () => ({ rpc: state.rpc, from: (table: string) => {
  let operation = "read";
  let payload: Record<string, unknown> = {};
  const execute = async () => {
    if (operation === "insert") {
      if (state.versions.some(v => v.version === payload.version)) return { data: null, error: { code: "23505" } };
      state.versions.push({ version: Number(payload.version), payload_enc: String(payload.payload_enc) });
    }
    if (operation === "update" && payload.pay_type) state.payType = String(payload.pay_type);
    return { data: [{ id: "worker" }], error: null };
  };
  const query = {
    select: () => query, eq: () => query, order: () => query,
    insert: (value: Record<string, unknown>) => { operation = "insert"; payload = value; return query; },
    update: (value: Record<string, unknown>) => { operation = "update"; payload = value; return query; },
    limit: () => query,
    maybeSingle: async () => ({ data: table === "workers" ? { id: "worker", active: true, pay_type: state.payType } : { version: state.versions.at(-1)!.version }, error: null }),
    then: (resolve: (value: unknown) => unknown) => (table === "effective_compensations" ? Promise.resolve({ data: [], error: null }) : execute()).then(resolve),
  }; return query;
} }), must: (result: { data: unknown; error: unknown }) => { if (result.error) throw new Error("database unavailable"); return result.data; } }));
import { addCompensationVersion } from "@/server/db/workers";

beforeEach(() => {
  state.payType = "SALARIED"; state.versions = [{ version: 1, payload_enc: "initial" }]; state.audit = [];
  vi.clearAllMocks();
  // Models atomic commit/response interleavings, not SQL enforcement; disposable DB tests verify the RPC.
  state.rpc.mockImplementation(async (_name, params) => {
    const event = params.p_event;
    if (event.expected_version !== state.versions.at(-1)!.version) return { data: "CONFLICT", error: null };
    state.versions.push({ version: event.expected_version + 1, payload_enc: event.payload_enc });
    const previous = state.payType;
    if (event.pay_type) state.payType = event.pay_type;
    state.audit.push({ event: "compensation.version", refs: { version: event.expected_version + 1, reason: event.reason } });
    if (event.pay_type && previous !== event.pay_type) state.audit.push({ event: "worker.pay_type", refs: { from: previous, to: event.pay_type } });
    if (event.expected_version === 1) { state.inserted(); await state.continueFirst; }
    return { data: "OK", error: null };
  });
});

it("a delayed earlier response cannot pair a later immutable compensation with an earlier pay type", async () => {
  let resume!: () => void;
  state.continueFirst = new Promise<void>(resolve => { resume = resolve; });
  const inserted = new Promise<void>(resolve => { state.inserted = resolve; });
  const who = { companyId: "company", userId: "user", correlationId: "request", roles: ["PAYROLL_APPROVER"] as const };
  const earlier = addCompensationVersion(who, "worker", { baseAmount: 0n, hourlyRate: 111n }, "HOURLY", "ROLE_CHANGE");
  await inserted;
  try {
    expect(await addCompensationVersion(who, "worker", { baseAmount: 222n, hourlyRate: 0n }, "RETAINER", "ROLE_CHANGE")).toBe(true);
  } finally { resume(); }
  expect(await earlier).toBe(true);
  expect(state.versions.map(v => v.version)).toEqual([1, 2, 3]);
  expect(JSON.parse(state.versions.at(-1)!.payload_enc)).toEqual({ baseAmount: "222", hourlyRate: "0" });
  expect(state.payType).toBe("RETAINER");
  expect(state.audit.filter(event => event.event === "compensation.version")).toHaveLength(2);
  expect(state.audit.filter(event => event.event === "worker.pay_type").at(-1)?.refs.to).toBe("RETAINER");
});

it.each(["FORBIDDEN", "INVALID_TRANSITION", "CONFLICT"])("fails closed on atomic append %s without a separate pay-type write", async code => {
  state.rpc.mockResolvedValue({ data: code, error: null });
  await expect(addCompensationVersion({ companyId: "company", userId: "user", correlationId: "request" }, "worker", { baseAmount: 2n, hourlyRate: 0n }, "RETAINER")).rejects.toMatchObject({ code });
  expect(state.payType).toBe("SALARIED"); expect(state.versions).toHaveLength(1); expect(state.audit).toEqual([]);
});
