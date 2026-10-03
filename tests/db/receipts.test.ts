// P4 receipts (S36) and Kleeno Verify's data path (S68): real repositories, fake Gateway facilitator, no network.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RECEIPT_HMAC_SECRET ||= "db-test-receipt-secret-0123456789abcdef"; // gitleaks:allow (fake test value) CI has no real one; the route reads it through env.ts
  process.env.X402_SELLER_ADDRESS ||= "0x2222222222222222222222222222222222222222";
});

import { POST as mintRoute } from "@/app/api/receipts/route";
import { readReceiptToken } from "@/core/receipt";
import { X402_PRICE } from "@/core/x402";
import { approveRun } from "@/server/db/approval";
import { proposeBatch, signBatch } from "@/server/db/batches";
import { factsForObligation, mintReceipt, receiptByToken, verifyTarget } from "@/server/db/receipts";
import { x402Ledger } from "@/server/db/x402";
import { executeBatch } from "@/server/payments/execute";
import { handleVerify, type Deps } from "@/server/x402/verify";
import { admin, call, cookieFor, makeCompany, pendingRun, type TestCompany } from "./helpers";
import { agentDepsFor, DbChain, DbRail, FakePort } from "./payment-fakes";

const SECRET = "unit-test-secret-0123456789abcdef0123456789";
const payroll = (c: TestCompany) => ({ companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles });
const payment = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });

/** A LIVE company with a signed batch; `pay` settles every obligation on the fake chain. */
async function fixture(pay: boolean) {
  const c = await makeCompany({ live: true });
  const run = await pendingRun(c, undefined, 1, 1);
  await approveRun(payroll(c), run.runId);
  const { batchId } = await proposeBatch(payment(c), run.runId, []);
  await signBatch(payment(c), batchId, new FakePort());
  const chain = new DbChain();
  await chain.commitBatch(batchId);
  if (pay) await executeBatch(payment(c), batchId, { deps: agentDepsFor(chain, new DbRail(chain, "OK")) });
  const obs = (await admin.from("obligations").select("id, status, tx_hash, onchain_key, amount").eq("batch_id", batchId).order("id")).data!;
  return { c, obs, run };
}

describe("minting a receipt link (S36)", () => {
  it("works for a SETTLED payment, is audited, and the link shows only the allow-listed facts", async () => {
    const { c, obs } = await fixture(true);
    const minted = await mintReceipt(payment(c), obs[0].id, SECRET);
    expect(minted.path).toBe(`/receipt/${minted.token}`);
    expect(readReceiptToken(SECRET, minted.token)).toBe(obs[0].id);
    expect(new Date(minted.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    expect((await admin.from("audit_events").select("actor, refs").eq("event", "receipt.minted").eq("entity_id", obs[0].id)).data).toHaveLength(1);

    const facts = await receiptByToken(minted.token, SECRET);
    expect(facts).toEqual({ status: "SETTLED", amount: BigInt(obs[0].amount), txHash: obs[0].tx_hash, network: "ARC-TESTNET", matchesApproved: true });
    expect(Object.keys(facts!).sort()).toEqual(["amount", "matchesApproved", "network", "status", "txHash"]);
  });

  it("is refused for a payment that is not settled, another company's payment, and roles that cannot hand out receipts", async () => {
    const unsettled = await fixture(false);
    await expect(mintReceipt(payment(unsettled.c), unsettled.obs[0].id, SECRET)).rejects.toMatchObject({ code: "CONFLICT" });
    const settled = await fixture(true);
    await expect(mintReceipt(payment(unsettled.c), settled.obs[0].id, SECRET)).rejects.toMatchObject({ code: "NOT_FOUND" }); // looks the same as a missing one
    await expect(mintReceipt({ ...payment(settled.c), roles: ["VIEWER"] }, settled.obs[0].id, SECRET)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.from("audit_events").select("id").eq("event", "receipt.minted").eq("company_id", unsettled.c.id)).data).toEqual([]);
  });

  it("a forged, expired or other-secret token shows nothing", async () => {
    const { c, obs } = await fixture(true);
    const { token } = await mintReceipt(payment(c), obs[0].id, SECRET);
    expect(await receiptByToken(token, "another-secret-0123456789abcdef012345")).toBeNull();
    expect(await receiptByToken(`${token}x`, SECRET)).toBeNull();
    expect(await receiptByToken("nonsense", SECRET)).toBeNull();
  });

  it("the route mints for the session's company only, with a signed link", async () => {
    const { c, obs } = await fixture(true);
    const other = await fixture(true);
    const cookie = (await cookieFor(c.payment)).cookie;
    const ok = await call(mintRoute, { cookie, body: { obligationId: obs[0].id } });
    expect(ok.status).toBe(200);
    expect(readReceiptToken(process.env.RECEIPT_HMAC_SECRET!, (await ok.json()).token)).toBe(obs[0].id);
    expect((await call(mintRoute, { cookie, body: { obligationId: other.obs[0].id } })).status).toBe(404);
    expect((await call(mintRoute, { cookie, body: { obligationId: obs[0].id, companyId: other.c.id } })).status).toBe(400);
    expect((await call(mintRoute, { body: { obligationId: obs[0].id } })).status).toBe(401);
  });
});

describe("Kleeno Verify data path (S68)", () => {
  const seller = "0x2222222222222222222222222222222222222222";
  const header = (nonce: string) => Buffer.from(JSON.stringify({ x402Version: 2, payload: { signature: "0xsig", authorization: { from: "0x3333333333333333333333333333333333333333", to: seller, value: X402_PRICE.toString(), validAfter: "0", validBefore: "9999999999", nonce } } })).toString("base64");
  const nonce = () => `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
  const deps = (settle: () => Promise<{ success: boolean }>): Deps => ({
    allow: async () => true,
    sellerAddress: () => seller,
    target: (t) => verifyTarget(t, SECRET),
    facts: factsForObligation,
    ledger: x402Ledger,
    facilitator: { settle },
  });
  const get = (d: Deps, q: string, h?: string) => handleVerify(new Request(`https://kleeno.test/api/x402/verify?${q}`, { headers: h ? { "payment-signature": h } : {} }), d);

  it("answers by obligation key or receipt token after settlement, records the payment, and a replay is refused", async () => {
    const { c, obs } = await fixture(true);
    const { token } = await mintReceipt(payment(c), obs[0].id, SECRET);
    let settles = 0;
    const d = deps(async () => (settles++, { success: true }));
    const n1 = nonce();
    const byKey = await get(d, `obligation=${obs[0].onchain_key}`, header(n1));
    expect(byKey.status).toBe(200);
    expect(await byKey.json()).toEqual({ settled: true, status: "SETTLED", netAmountUsdc: expect.any(String), txHash: obs[0].tx_hash, chain: "arc-testnet", matchesApproved: true });
    expect((await get(d, `receipt=${encodeURIComponent(token)}`, header(nonce()))).status).toBe(200);
    expect((await get(d, `obligation=${obs[0].onchain_key}`, header(n1))).status).toBe(402); // same signed payment again
    expect(settles).toBe(2);
    const rows = (await admin.from("x402_payments").select("status, obligation_id, company_id, amount").eq("company_id", c.id)).data!;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "SETTLED" && r.obligation_id === obs[0].id && Number(r.amount) === 10000)).toBe(true);
  });

  it("an unsettled obligation is reported as not settled; a failed settlement leaves no answer and a FAILED row", async () => {
    const { c, obs } = await fixture(false);
    const ok = await get(deps(async () => ({ success: true })), `obligation=${obs[0].onchain_key}`, header(nonce()));
    expect(await ok.json()).toMatchObject({ settled: false, status: "AUTHORIZED", txHash: null });
    const n = nonce();
    const bad = await get(deps(async () => ({ success: false })), `obligation=${obs[1].onchain_key}`, header(n));
    expect(bad.status).toBe(402);
    expect((await admin.from("x402_payments").select("status").eq("nonce", n).single()).data!.status).toBe("FAILED");
    expect((await admin.from("x402_payments").select("id").eq("company_id", c.id)).data).toHaveLength(2);
  });

  it("an unknown key or foreign token is a 404 that settles nothing", async () => {
    let settles = 0;
    const d = deps(async () => (settles++, { success: true }));
    expect((await get(d, `obligation=0x${"aa".repeat(32)}`, header(nonce()))).status).toBe(404);
    expect((await get(d, "receipt=forged.token", header(nonce()))).status).toBe(404);
    expect(settles).toBe(0);
  });

  it("the ledger keeps one row per authorization nonce and a finished payment cannot move or change", async () => {
    const { c, obs } = await fixture(true);
    const p = { companyId: c.id, obligationId: obs[0].id, nonce: nonce(), payer: `0x${"33".repeat(20)}`, amount: X402_PRICE };
    expect(await x402Ledger.begin(p)).toBe("NEW");
    expect(await x402Ledger.begin(p)).toBe("REPLAY");
    await x402Ledger.finish(p.nonce, { status: "SETTLED", ref: "gw-1" });
    await x402Ledger.finish(p.nonce, { status: "FAILED" }); // too late: no effect
    expect((await admin.from("x402_payments").select("status, settlement_ref").eq("nonce", p.nonce).single()).data).toEqual({ status: "SETTLED", settlement_ref: "gw-1" });
    expect((await admin.from("x402_payments").update({ status: "FAILED" }).eq("nonce", p.nonce)).error).not.toBeNull();
    expect((await admin.from("x402_payments").update({ amount: 1 }).eq("nonce", p.nonce)).error).not.toBeNull();
    expect((await admin.from("x402_payments").delete().eq("nonce", p.nonce)).error).not.toBeNull();
    expect((await x402Ledger.begin({ ...p, obligationId: randomUUID(), nonce: nonce() }).catch(() => "ERR"))).toBe("ERR"); // an obligation that does not exist
  });
});
