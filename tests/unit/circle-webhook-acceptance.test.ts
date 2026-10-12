import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseContext, clock, expectChain, FakeChain, FakeRail, FakeRepo } from "../invariants/payments/harness";

const wiring = vi.hoisted(() => ({ db: vi.fn(), deps: undefined as unknown }));
vi.mock("@/server/db/client", () => ({ db: wiring.db, must: (r: { data: unknown; error?: unknown }) => { if (r.error) throw new Error("read failed"); return r.data; } }));
vi.mock("@/server/env", () => ({ env: {} }));
vi.mock("@/server/payments/execute", async (original) => {
  const actual = await original<typeof import("@/server/payments/execute")>();
  return { ...actual, onCircleNotification: (n: Parameters<typeof actual.onCircleNotification>[0], o: Parameters<typeof actual.onCircleNotification>[1]) => actual.onCircleNotification(n, { ...o, deps: wiring.deps as import("@/core/payments/agent").AgentDeps }) };
});
import { POST } from "@/app/api/circle/webhook/route";
import { verifyCircleSignature } from "@/server/circle/webhook";

const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyId = randomUUID();
const signature = (raw: string) => sign("sha256", Buffer.from(raw), { key: pair.privateKey, dsaEncoding: "der" }).toString("base64");
let repo: FakeRepo, chain: FakeChain, rail: FakeRail;
let notifications: Set<string>;
let readFailure: string | null;

beforeEach(async () => {
  vi.stubEnv("SITE_MODE", "app");
  notifications = new Set(); readFailure = null;
  const ctx = baseContext(); ctx.obligation.status = "PAYING";
  repo = new FakeRepo(ctx);
  repo.attempts.push({ id: "att-1", state: "SUBMITTED", key: "idem-1", circleTxId: "c-1" });
  chain = new FakeChain(); chain.paid = true; chain.paidTx = "0xtx1"; chain.goodReceipt("0xtx1");
  rail = new FakeRail(chain); rail.sends = 1;
  wiring.deps = { repo, chain, rail, clock, expect: expectChain, maxPolls: 1 };
  wiring.db.mockImplementation(() => ({ from: (table: string) => {
    const filters: Record<string, string> = {};
    let inserted: { notification_id: string } | undefined;
    const result = () => {
      if (table === "payment_attempts") return { data: filters.circle_tx_id === "c-1" ? { obligation_id: "ob-1", company_id: "co-1" } : null, error: readFailure === table ? { code: "08006" } : null };
      if (table === "obligations") return { data: { batch_id: null }, error: readFailure === table ? { code: "08006" } : null };
      if (table !== "webhook_notifications") throw new Error(`unexpected table ${table}`);
      if (inserted) {
        if (notifications.has(inserted.notification_id)) return { data: null, error: { code: "23505" } };
        notifications.add(inserted.notification_id); return { data: [{ id: "notification" }], error: null };
      }
      return { data: notifications.has(filters.notification_id) ? { id: "notification" } : null, error: readFailure === table ? { code: "08006" } : null };
    };
    const query = { select: () => query, eq: (k: string, v: string) => { filters[k] = v; return query; }, insert: (row: { notification_id: string }) => { inserted = row; return query; }, maybeSingle: async () => result(), then: (resolve: (r: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  } }));
  const raw = "cache public synthetic key";
  expect(await verifyCircleSignature(raw, signature(raw), keyId, async () => pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"))).toBe(true);
});

afterEach(() => vi.unstubAllEnvs());

function deliver(id: string, state = "COMPLETE", tx = "c-1", tamper = false) {
  const raw = JSON.stringify({ notificationId: id, notificationType: "transactions.outbound", notification: { id: tx, state, amount: "999999", recipient: "untrusted" } });
  return POST(new Request("https://synthetic.example/api/circle/webhook", { method: "POST", body: tamper ? raw + " " : raw, headers: { "x-circle-key-id": keyId, "x-circle-signature": signature(raw) } }));
}

describe("R10.2 signed HTTP hints through the real executor and recovery", () => {
  it("settles from Arc once despite replay and a distinct stale failure event", async () => {
    expect((await deliver("latest")).status).toBe(200);
    expect(repo.status).toBe("SETTLED");
    expect(repo.txHash).toBe("0xtx1");
    expect((await deliver("latest")).status).toBe(200);
    expect((await deliver("older", "FAILED")).status).toBe(200);
    expect(notifications.size).toBe(2);
    expect(repo.status).toBe("SETTLED"); expect(rail.submits).toBe(0); expect(rail.sends).toBe(1);
  });
  it("concurrent copies retain one notification and never submit another payment", async () => {
    expect((await Promise.all([deliver("race"), deliver("race")])).map((r) => r.status)).toEqual([200, 200]);
    expect(notifications.size).toBe(1); expect(repo.status).toBe("SETTLED"); expect(rail.submits).toBe(0); expect(rail.sends).toBe(1);
  });
  it("a failed Arc re-query returns 500 without consuming the notification; retry succeeds", async () => {
    const isPaid = vi.spyOn(chain, "isPaid").mockRejectedValueOnce(new Error("synthetic outage"));
    expect((await deliver("retry")).status).toBe(500);
    expect(notifications.size).toBe(0); expect(repo.status).toBe("PAYING");
    expect((await deliver("retry")).status).toBe(200);
    expect(isPaid).toHaveBeenCalledTimes(2); expect(notifications.size).toBe(1); expect(rail.submits).toBe(0);
  });
  it.each(["payment_attempts", "webhook_notifications", "obligations"])("a failed %s lookup is retryable rather than acknowledged and lost", async (table) => {
    readFailure = table;
    expect((await deliver("lookup-retry")).status).toBe(500);
    expect(notifications.size).toBe(0);
    readFailure = null;
    expect((await deliver("lookup-retry")).status).toBe(200);
    expect(repo.status).toBe("SETTLED");
  });
  it("tampered signatures and unknown transactions cannot change payroll", async () => {
    expect((await deliver("tampered", "COMPLETE", "c-1", true)).status).toBe(401);
    expect((await deliver("unknown", "COMPLETE", "unknown")).status).toBe(200);
    expect(notifications.size).toBe(0); expect(repo.status).toBe("PAYING"); expect(rail.submits).toBe(0);
  });
});
