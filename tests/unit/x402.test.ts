// S68: Kleeno Verify. No payment -> 402 with the price; a wrong amount or recipient never reaches the facilitator; nothing is answered
// before settlement succeeds; the answer holds only the allow-listed fields. Fake ports, so nothing touches the network or the database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VERIFY_ANSWER_FIELDS, X402_PRICE, paymentRequirements } from "@/core/x402";
import type { ReceiptFacts } from "@/core/receipt";
import { handleVerify, type Deps } from "@/server/x402/verify";

const seller = "0x2222222222222222222222222222222222222222";
const buyer = "0x3333333333333333333333333333333333333333";
const KEY = `0x${"cd".repeat(32)}`;
const facts: ReceiptFacts = { status: "SETTLED", amount: 1_234_560_000n, txHash: `0x${"ef".repeat(32)}`, network: "ARC-TESTNET", matchesApproved: true };

const header = (o: { value?: string; to?: string; nonce?: string; network?: string } = {}) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: { network: o.network ?? "eip155:5042002" },
      payload: { signature: "0xsig", authorization: { from: buyer, to: o.to ?? seller, value: o.value ?? X402_PRICE.toString(), validAfter: "0", validBefore: "99999999999", nonce: o.nonce ?? `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` } },
    }),
  ).toString("base64");

function harness(over: Partial<Deps> & { settle?: boolean | "throw" } = {}) {
  const calls = { settle: 0, lookups: 0, begins: [] as string[], finished: [] as string[] };
  const seen = new Set<string>();
  const deps: Deps = {
    allow: async () => true,
    sellerAddress: () => seller,
    target: async () => (calls.lookups++, { obligationId: randomUUID(), companyId: randomUUID() }),
    facts: async () => facts,
    ledger: {
      begin: async (p) => (calls.begins.push(p.nonce), seen.has(p.nonce) ? "REPLAY" : (seen.add(p.nonce), "NEW")),
      finish: async (_n, o) => void calls.finished.push(o.status),
    },
    facilitator: {
      settle: async () => {
        calls.settle++;
        if (over.settle === "throw") throw new Error("gateway down");
        return { success: over.settle !== false, payer: buyer, transaction: "gw-tx-1" };
      },
    },
    ...over,
  };
  return { deps, calls };
}
const get = (deps: Deps, query: string, h?: string) => handleVerify(new Request(`https://kleeno.test/api/x402/verify?${query}`, { headers: h ? { "payment-signature": h } : {} }), deps);

describe("Kleeno Verify (S68)", () => {
  it("answers 402 with the price, network and seller address when nothing is paid, and looks nothing up", async () => {
    const { deps, calls } = harness();
    const res = await get(deps, "receipt=abc");
    expect(res.status).toBe(402);
    const req = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString());
    expect(req.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:5042002", amount: "10000", payTo: seller });
    expect(req.accepts[0]).toEqual(paymentRequirements(seller));
    expect(calls).toMatchObject({ lookups: 0, settle: 0 });
  });

  it("402 for a wrong amount, wrong recipient, wrong network or a garbled header, and the facilitator is never called", async () => {
    for (const bad of [header({ value: "9999" }), header({ value: "10001" }), header({ to: buyer }), header({ network: "eip155:8453" }), "not-base64-json", header().slice(0, 40)]) {
      const { deps, calls } = harness();
      const res = await get(deps, `obligation=${KEY}`, bad);
      expect(res.status).toBe(402);
      expect(calls).toMatchObject({ settle: 0, lookups: 0 });
    }
  });

  it("returns no data when settlement fails or throws, and records the payment as failed", async () => {
    for (const settle of [false, "throw"] as const) {
      const { deps, calls } = harness({ settle });
      const res = await get(deps, `obligation=${KEY}`, header());
      expect(res.status).toBe(402);
      expect(JSON.stringify(await res.json())).not.toMatch(/netAmount|txHash/);
      expect(calls.finished).toEqual(["FAILED"]);
    }
  });

  it("settles first, then answers with exactly the allow-listed fields", async () => {
    const { deps, calls } = harness();
    const res = await get(deps, `obligation=${KEY}`, header());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([...VERIFY_ANSWER_FIELDS].sort());
    expect(body).toEqual({ settled: true, status: "SETTLED", netAmountUsdc: "1234.56", txHash: facts.txHash, chain: "arc-testnet", matchesApproved: true });
    expect(calls).toMatchObject({ settle: 1, finished: ["SETTLED"] });
    expect(JSON.parse(Buffer.from(res.headers.get("payment-response")!, "base64").toString())).toMatchObject({ success: true, network: "eip155:5042002" });
  });

  it("reports not settled and not matching without inventing facts", async () => {
    const { deps } = harness({ facts: async () => ({ ...facts, status: "PAYING", txHash: null, matchesApproved: false }) });
    expect(await (await get(deps, `obligation=${KEY}`, header())).json()).toMatchObject({ settled: false, status: "PAYING", txHash: null, matchesApproved: false });
  });

  it("a signed payment buys one answer: the second use of the same authorization is refused before settlement", async () => {
    const { deps, calls } = harness();
    const h = header();
    expect((await get(deps, `obligation=${KEY}`, h)).status).toBe(200);
    expect((await get(deps, `obligation=${KEY}`, h)).status).toBe(402);
    expect(calls.settle).toBe(1);
  });

  it("404 without settling when the target does not exist, so the buyer is not charged", async () => {
    const { deps, calls } = harness({ target: async () => null });
    expect((await get(deps, `obligation=${KEY}`, header())).status).toBe(404);
    expect(calls.settle).toBe(0);
  });

  it("rejects ambiguous or malformed queries, throttles, and fails closed without a seller address", async () => {
    const { deps } = harness();
    for (const q of ["", `receipt=a&obligation=${KEY}`, "obligation=0x12", "name=Alice", "receipt="]) expect((await get(deps, q, header())).status).toBe(400);
    expect((await get(harness({ allow: async () => false }).deps, "receipt=abc")).status).toBe(429);
    expect((await get(harness({ sellerAddress: () => undefined }).deps, "receipt=abc")).status).toBe(503);
  });
});
