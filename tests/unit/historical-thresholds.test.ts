import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), open: vi.fn(), seal: vi.fn(), fingerprint: vi.fn(), lines: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => calls, must: (r: { data: unknown; error: unknown }) => { if (r.error || r.data == null) throw new Error("scoped database read failed"); return r.data; } }));
vi.mock("@/server/crypto", () => ({ openJson: calls.open, sealJson: calls.seal, fingerprint: calls.fingerprint }));
vi.mock("@/server/db/calculations", () => ({ loadLines: calls.lines }));
import { HistoricalThresholdSettingsSchema, toHistoricalThresholds } from "@/core/variance/threshold-settings";
import { loadHistoricalThresholds, saveHistoricalThresholds } from "@/server/db/historical-thresholds";
const COMPANY = "11111111-1111-4111-8111-111111111111", RUN = "22222222-2222-4222-8222-222222222222", KEY = "33333333-3333-4333-8333-333333333333";
const actor = { companyId: COMPANY, userId: KEY, roles: ["HR_APPROVER"] as const, correlationId: KEY };
const command = () => ({ expectedRevision: 0, idempotencyKey: KEY, rules: [{ id: "base-change", component: "base", absolute: "1000000", percent: { n: "5", d: "2" } }] });
let roles: string[], version: { id: string; revision: number; payload_enc: string; configuration_hash: string } | null, signed: boolean;
const reads: { table: string; company: string | null; run: string | null }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); roles = ["HR_APPROVER"]; version = null; signed = false; reads.length = 0;
  calls.rpc.mockResolvedValue({ data: { code: "OK" }, error: null }); calls.seal.mockResolvedValue("sealed-rules"); calls.open.mockResolvedValue(command().rules); calls.fingerprint.mockResolvedValue("a".repeat(64)); calls.lines.mockResolvedValue([{ trace: [{ component: "base" }] }]);
  calls.from.mockImplementation((table: string) => {
    const read = { table, company: null as string | null, run: null as string | null }; reads.push(read); let single = false;
    const q = { select() { return q; }, eq(key: string, value: string) { if (key === "company_id") read.company = value; if (key === "run_id") read.run = value; return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { single = true; return q; },
      then(resolve: (v: unknown) => unknown) { const values = table === "memberships" ? roles.length ? [{ roles }] : [] : table === "payroll_runs" ? [{ id: RUN }] : table === "calculations" ? [{ id: "calculation" }] : table === "payroll_review_events" ? signed ? [{ id: "signoff" }] : [] : version ? [version] : []; return Promise.resolve({ data: single ? values[0] ?? null : values, error: null }).then(resolve); } };
    return q;
  });
});
describe("explicit threshold settings boundary", () => {
  it("preserves exact native strings and supplies no defaults", () => {
    expect(HistoricalThresholdSettingsSchema.parse({ ...command(), rules: [] }).rules).toEqual([]);
    expect(toHistoricalThresholds("version-id", command().rules)).toEqual({ version: "version-id", rules: [{ id: "base-change", component: "base", absolute: 1000000n, percent: { n: 5n, d: 2n } }] });
  });
  it.each(["negative", "denominator", "empty", "duplicate", "count", "forged"])("rejects %s configuration", invalid => {
    const v = command();
    if (invalid === "negative") v.rules[0].absolute = "-1";
    if (invalid === "denominator") v.rules[0].percent.d = "0";
    if (invalid === "empty") Object.assign(v.rules[0], { absolute: null, percent: null });
    if (invalid === "duplicate") v.rules.push(v.rules[0]);
    if (invalid === "count") v.rules = Array.from({ length: 21 }, (_, i) => ({ ...v.rules[0], id: `rule-${i}` }));
    expect(() => HistoricalThresholdSettingsSchema.parse(invalid === "forged" ? { ...v, companyId: COMPANY } : v)).toThrow();
  });
});
describe("versioned encrypted threshold settings", () => {
  it("returns unconfigured settings without decryption or invented thresholds", async () => {
    expect(await loadHistoricalThresholds(calls as never, actor, RUN)).toEqual({ revision: 0, version: null, configurationHash: null, rules: [], canConfigure: true });
    expect(calls.open).not.toHaveBeenCalled(); expect(reads.every(r => r.company === COMPANY)).toBe(true);
  });
  it("uses current role rather than supplied role and restricts payment readers to read only", async () => {
    roles = ["VIEWER"];
    await expect(loadHistoricalThresholds(calls as never, actor, RUN)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.open).not.toHaveBeenCalled();
    roles = ["PAYMENT_APPROVER"];
    expect((await loadHistoricalThresholds(calls as never, actor, RUN)).canConfigure).toBe(false);
    await expect(saveHistoricalThresholds(calls as never, actor, RUN, command())).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls.seal).not.toHaveBeenCalled();
  });
  it("does not accept unknown component names or send plaintext settings to storage", async () => {
    const v = command(); v.rules[0].component = "invented";
    await expect(saveHistoricalThresholds(calls as never, actor, RUN, v)).rejects.toMatchObject({ code: "CONFLICT" }); expect(calls.rpc).not.toHaveBeenCalled();
    await saveHistoricalThresholds(calls as never, actor, RUN, command());
    const [name, args] = calls.rpc.mock.calls[0]; expect(name).toBe("append_historical_thresholds");
    expect(args).toMatchObject({ p_company: COMPANY, p_run: RUN, p_actor: KEY, p_expected_revision: 0, p_idempotency_key: KEY, p_payload_enc: "sealed-rules", p_configuration_hash: "a".repeat(64) });
    expect(JSON.stringify(args)).not.toContain("1000000"); expect(calls.seal.mock.calls[0].slice(0, 3)).toEqual([COMPANY, "historical_threshold_versions", "payload_enc"]);
  });
  it("signed read models cannot configure and stale/frozen/foreign RPC results fail closed", async () => {
    version = { id: KEY, revision: 1, payload_enc: "ciphertext", configuration_hash: "a".repeat(64) }; signed = true;
    expect(await loadHistoricalThresholds(calls as never, actor, RUN)).toMatchObject({ revision: 1, version: KEY, canConfigure: false });
    for (const code of ["CONFLICT", "FROZEN", "FORBIDDEN", "NOT_FOUND"]) {
      calls.rpc.mockResolvedValue({ data: { code }, error: null });
      await expect(saveHistoricalThresholds(calls as never, actor, RUN, command())).rejects.toMatchObject({ code: code === "FROZEN" ? "CONFLICT" : code });
    }
  });
});
