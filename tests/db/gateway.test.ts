// P4 slice 6: Gateway top-up (S67, rule 28). Real repositories and triggers; Circle and the Gateway API are a scripted fake, so no funds move.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as infoRoute, POST as topupRoute } from "@/app/api/gateway/topup/route";
import { POST as continueRoute } from "@/app/api/gateway/topup/[id]/route";
import { depositFor, GATEWAY_MINTER, GATEWAY_WALLET, SOURCES } from "@/core/gateway";
import { advanceTopup, requestTopup, topupInfo, type GatewayPort } from "@/server/circle/gateway";
import { admin, ADDR, call, cookieFor, makeCompany, uniq, withId, type TestCompany } from "./helpers";

const who = (c: TestCompany) => ({ companyId: c.id, userId: c.payment.id, roles: c.payment.roles });
const USDC5 = 5_000_000n;

/** A company with its approver wallet on file (as provisioning leaves it) and no guard: top-ups do not need one. */
async function fixture(opts: { wallet?: boolean } = {}) {
  const c = await makeCompany();
  const approver = ADDR(0xb000 + Math.floor(Math.random() * 1e6));
  if (opts.wallet !== false) await admin.from("company_wallets").insert({ company_id: c.id, role: "APPROVER", circle_wallet_id: `w-${uniq()}`, address: approver, blockchain: "ARC-TESTNET" });
  return { c, approver };
}

class FakeGateway implements GatewayPort {
  calls: string[] = [];
  executed: { walletId: string; contract: string; signature: string; params: unknown[]; idempotencyKey: string }[] = [];
  signed: string[] = [];
  transfers: { burnIntent: unknown; signature: string }[] = [];
  pending = new Set<string>(); // "approve" | "deposit" | "mint": tx stays PENDING while listed
  failing = new Set<string>(); // tx ends FAILED
  credited = 1_000_000_000n;
  transferOk = true;
  private tx = new Map<string, string>(); // tx id -> step
  async deriveSourceWallet() {
    this.calls.push("derive");
    return { walletId: "src-wallet" };
  }
  async execute(o: Parameters<GatewayPort["execute"]>[0]) {
    this.executed.push(o);
    const step = o.signature.startsWith("approve") ? "approve" : o.signature.startsWith("deposit") ? "deposit" : "mint";
    this.calls.push(step);
    const txId = `tx-${o.idempotencyKey}`; // Circle returns the same transaction for the same idempotency key
    this.tx.set(txId, step);
    return { txId };
  }
  async txState(txId: string) {
    const step = this.tx.get(txId) ?? (txId.includes("mint") ? "mint" : "x");
    if (this.failing.has(step)) return { state: "FAILED" as const };
    if (this.pending.has(step)) return { state: "PENDING" as const };
    return { state: "COMPLETE" as const, txHash: `0x${"ab".repeat(32)}` };
  }
  async signTypedData(o: { walletId: string; data: string }) {
    this.calls.push("sign");
    this.signed.push(o.data);
    return `0xsig${this.signed.length}`;
  }
  async gatewayBalance() {
    this.calls.push("balance");
    return this.credited;
  }
  async transfer(burnIntent: unknown, signature: string) {
    this.calls.push("transfer");
    this.transfers.push({ burnIntent, signature });
    if (!this.transferOk) throw new Error("gateway says no");
    return { attestation: "0xattest", signature: "0xoperator" };
  }
}

const row = async (id: string) => (await admin.from("gateway_transfers").select("*").eq("id", id).single()).data!;

describe("a Gateway top-up", () => {
  it("runs derive, approve, deposit, credit, sign, attest and mint in order, to the company's own approver wallet only", async () => {
    const { c, approver } = await fixture();
    const port = new FakeGateway();
    const started = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    expect(started).toMatchObject({ status: "REQUESTED", amount: "5.00", recipient: approver });
    const out = await advanceTopup(who(c), started.id, { port, budgetMs: 0 });
    expect(out).toMatchObject({ status: "COMPLETE", done: true, mintTxHash: `0x${"ab".repeat(32)}` });
    expect(port.calls).toEqual(["derive", "approve", "deposit", "balance", "sign", "transfer", "mint"]);

    // approve and deposit only touch USDC and the Gateway Wallet, for the amount plus the fee cap
    const [approve, deposit, mint] = port.executed;
    expect([approve.contract, approve.signature, approve.params]).toEqual([SOURCES["BASE-SEPOLIA"].usdc, "approve(address,uint256)", [GATEWAY_WALLET, depositFor(USDC5).toString()]]);
    expect([deposit.contract, deposit.signature, deposit.params]).toEqual([GATEWAY_WALLET, "deposit(address,uint256)", [SOURCES["BASE-SEPOLIA"].usdc, depositFor(USDC5).toString()]]);
    expect([mint.contract, mint.signature]).toEqual([GATEWAY_MINTER, "gatewayMint(bytes,bytes)"]);
    expect(new Set(port.executed.map((e) => e.idempotencyKey)).size).toBe(3); // one key per step

    // the signed burn intent names the approver as depositor AND recipient
    const typed = JSON.parse(port.signed[0]);
    const pad = `0x${approver.slice(2).toLowerCase().padStart(64, "0")}`;
    expect([typed.message.spec.sourceDepositor, typed.message.spec.destinationRecipient]).toEqual([pad, pad]);
    expect(port.transfers[0].burnIntent).toEqual(typed.message);

    const events = (await admin.from("audit_events").select("event").eq("entity_id", started.id)).data!.map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["gateway.topup.requested", "gateway.topup.step", "gateway.topup.completed"]));
    // finished: calling again changes and sends nothing
    const before = port.calls.length;
    expect(await advanceTopup(who(c), started.id, { port })).toMatchObject({ status: "COMPLETE", done: true });
    expect(port.calls.length).toBe(before);
  });

  it("resumes where it stopped: a confirming approval waits, and no step is sent twice", async () => {
    const { c } = await fixture();
    const port = new FakeGateway();
    port.pending.add("approve");
    const { id } = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "SOURCE_READY", done: false, waiting: "approval confirming" });
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ waiting: "approval confirming" });
    port.pending.clear();
    port.credited = 0n;
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "DEPOSITED", waiting: "Gateway is crediting the deposit" });
    port.credited = 1_000_000_000n;
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "COMPLETE" });
    expect(port.calls.filter((x) => x === "approve")).toHaveLength(1);
    expect(port.calls.filter((x) => x === "deposit")).toHaveLength(1);
    expect(port.calls.filter((x) => x === "mint")).toHaveLength(1);
  });

  it("a Gateway refusal keeps the same signed intent for the retry (one signature, same salt)", async () => {
    const { c } = await fixture();
    const port = new FakeGateway();
    port.transferOk = false;
    const { id } = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "CREDITED", done: false });
    port.transferOk = true;
    expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "COMPLETE" });
    expect(port.signed).toHaveLength(1);
    expect(port.transfers).toHaveLength(2);
    expect(port.transfers[1]).toEqual(port.transfers[0]); // byte-identical retry
  });

  it("a failed approval, deposit or mint ends FAILED with a fixed code; a failed mint keeps the attestation", async () => {
    for (const step of ["approve", "deposit", "mint"]) {
      const { c } = await fixture();
      const port = new FakeGateway();
      port.failing.add(step);
      const { id } = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
      expect(await advanceTopup(who(c), id, { port, budgetMs: 0 })).toMatchObject({ status: "FAILED", done: true, failure: `${step.toUpperCase()}_FAILED` });
      if (step === "mint") expect((await row(id)).attestation).toBe("0xattest");
      // a finished (failed) top-up frees the company to start another
      await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    }
  });
});

describe("request rules (S67)", () => {
  it("only the Owner or a payment approver may top up; amounts outside 1-100 USDC are refused", async () => {
    const { c } = await fixture();
    for (const roles of [["VIEWER"], ["HR_APPROVER"], ["PAYROLL_APPROVER"]] as const) await expect(requestTopup({ ...who(c), roles: [...roles] }, { requestId: randomUUID(), amount: USDC5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestTopup({ ...who(c), roles: ["OWNER"] }, { requestId: randomUUID(), amount: USDC5 })).resolves.toMatchObject({ status: "REQUESTED" });
    const other = await fixture();
    for (const amount of [0n, 999_999n, 100_000_001n]) await expect(requestTopup(who(other.c), { requestId: randomUUID(), amount })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await admin.from("gateway_transfers").select("id").eq("company_id", other.c.id)).data).toEqual([]);
  });

  it("is idempotent per request ID, refuses a second request while one is active, and needs a payroll wallet", async () => {
    const { c } = await fixture();
    const requestId = randomUUID();
    const a = await requestTopup(who(c), { requestId, amount: USDC5 });
    expect(await requestTopup(who(c), { requestId, amount: USDC5 })).toEqual(a);
    await expect(requestTopup(who(c), { requestId, amount: USDC5 + 1n })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 })).rejects.toMatchObject({ code: "CONFLICT" });
    const bare = await fixture({ wallet: false });
    await expect(requestTopup(who(bare.c), { requestId: randomUUID(), amount: USDC5 })).rejects.toMatchObject({ code: "NOT_PROVISIONED" });
  });

  it("another company's top-up cannot be read or advanced", async () => {
    const a = await fixture();
    const b = await fixture();
    const { id } = await requestTopup(who(a.c), { requestId: randomUUID(), amount: USDC5 });
    await expect(advanceTopup(who(b.c), id, { port: new FakeGateway(), budgetMs: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the database refuses a destination that is not the company's approver wallet, and any later change to the request", async () => {
    const { c, approver } = await fixture();
    const base = { company_id: c.id, request_id: randomUUID(), requested_by: c.payment.id, amount: 5_000_000, max_fee: 100_000, source_chain: "BASE-SEPOLIA" };
    expect((await admin.from("gateway_transfers").insert({ ...base, depositor: approver, recipient: ADDR(0xdead) })).error?.message).toMatch(/own approver wallet/);
    expect((await admin.from("gateway_transfers").insert({ ...base, depositor: ADDR(0xdead), recipient: approver })).error?.message).toMatch(/own approver wallet/);
    expect((await admin.from("gateway_transfers").insert({ ...base, amount: 100_000_001, depositor: approver, recipient: approver })).error).not.toBeNull(); // cap in the schema too
    const other = await fixture(); // a different company's wallet is not ours either
    expect((await admin.from("gateway_transfers").insert({ ...base, depositor: other.approver, recipient: other.approver })).error).not.toBeNull();

    const { id } = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    for (const change of [{ recipient: ADDR(0xdead) }, { depositor: ADDR(0xdead) }, { amount: 99_000_000 }, { max_fee: 1 }, { company_id: other.c.id }]) expect((await admin.from("gateway_transfers").update(change).eq("id", id)).error).not.toBeNull();
    expect((await admin.from("gateway_transfers").delete().eq("id", id)).error).not.toBeNull();
  });

  it("a saved step cannot be replaced, a top-up never moves backwards, and a finished one never moves", async () => {
    const { c } = await fixture();
    const port = new FakeGateway();
    const { id } = await requestTopup(who(c), { requestId: randomUUID(), amount: USDC5 });
    await advanceTopup(who(c), id, { port, budgetMs: 0 });
    for (const change of [{ burn_salt: `0x${"11".repeat(32)}` }, { burn_signature: "0xother" }, { attestation: "0xother" }, { approve_tx_id: "other" }, { mint_tx_id: "other" }, { status: "REQUESTED" }, { status: "FAILED" }]) expect((await admin.from("gateway_transfers").update(change).eq("id", id)).error, JSON.stringify(change)).not.toBeNull();
  });
});

describe("the top-up routes", () => {
  it("need a role and the password, accept no destination, and change nothing on failure", async () => {
    const { c } = await fixture();
    const good = { requestId: randomUUID(), amount: "5", password: c.payment.password };
    const payment = (await cookieFor(c.payment)).cookie;
    const payroll = (await cookieFor(c.payroll)).cookie; // OWNER too: allowed
    const noRole = await makeCompany();
    await admin.from("memberships").update({ roles: ["VIEWER"] }).eq("user_id", noRole.payment.id).eq("company_id", noRole.id);
    const viewer = (await cookieFor(noRole.payment)).cookie;

    expect((await call(topupRoute, { cookie: viewer, body: good })).status).toBe(403);
    expect((await call(topupRoute, { cookie: payment, body: { ...good, password: "wrong-password" } })).status).toBe(401);
    expect((await call(topupRoute, { cookie: payment, body: { ...good, recipient: ADDR(0xdead) } })).status).toBe(400); // strict body: no destination field exists
    expect((await call(topupRoute, { cookie: payment, body: { ...good, amount: "101" } })).status).toBe(409);
    expect((await call(topupRoute, { cookie: payment, body: { requestId: good.requestId, amount: "5" } })).status).toBe(400); // no password: the strict body requires one
    expect((await admin.from("gateway_transfers").select("id").eq("company_id", c.id)).data).toEqual([]);

    const info = await call(infoRoute, { cookie: payroll, method: "GET" });
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ available: true, sourceChain: "BASE-SEPOLIA", cap: "100.00", recent: [] });
    expect((await call(continueRoute, { cookie: viewer }, withId(randomUUID()))).status).toBe(403);
    expect((await call(continueRoute, { cookie: payment }, withId(randomUUID()))).status).toBe(404);
    expect(await topupInfo(c.id)).toMatchObject({ available: true });
  });
});
