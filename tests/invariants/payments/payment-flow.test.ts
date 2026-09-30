// PROTECTED. S26 (no blind retry), S28 (timeout), S29 point 2 (crash after Circle call), S30 (settlement).
import { describe, expect, it } from "vitest";
import { payObligation } from "@/core/payments/agent";
import { matchSettlement } from "@/core/payments/settlement";
import { baseContext, clock, expectChain, FakeChain, FakeRail, FakeRepo, GUARD, KEY, RECIPIENT, USDC } from "./harness";

const run = (script: ConstructorParameters<typeof FakeRail>[1], chain = new FakeChain()) => {
  const repo = new FakeRepo(baseContext());
  const rail = new FakeRail(chain, script);
  const deps = { repo, chain, rail, clock, expect: expectChain, maxPolls: 3 };
  return { repo, rail, chain, deps, pay: () => payObligation("ob-1", deps) };
};

describe("payment flow", () => {
  it("running the payment twice moves money once (S26)", async () => {
    const t = run("OK");
    expect((await t.pay()).status).toBe("SETTLED");
    expect((await t.pay()).status).toBe("BLOCKED");
    expect(t.rail.sends).toBe(1);
    expect(t.repo.status).toBe("SETTLED");
  });

  it("two concurrent runs: only one claims (S26)", async () => {
    const t = run("OK");
    const [a, b] = await Promise.all([t.pay(), t.pay()]);
    expect(t.rail.sends).toBe(1);
    expect([a.status, b.status].filter((s) => s === "SETTLED")).toHaveLength(1);
  });

  it("attempt is saved before the rail is called (S26)", async () => {
    const t = run("OK");
    const origSubmit = t.rail.submit.bind(t.rail);
    let attemptsAtSubmit = -1;
    t.rail.submit = async (p, id) => {
      attemptsAtSubmit = t.repo.attempts.length;
      return origSubmit(p, id);
    };
    await t.pay();
    expect(attemptsAtSubmit).toBe(1);
  });

  it("crash/timeout after the Circle call: UNKNOWN, no resubmission (S28, S29 point 2)", async () => {
    const t = run("THROW_AFTER_SEND");
    expect((await t.pay()).status).toBe("UNKNOWN");
    expect(t.repo.status).toBe("PAYING");
    expect(t.repo.attempts[0].state).toBe("UNKNOWN");
    expect((await t.pay()).status).toBe("BLOCKED"); // gate refuses: not AUTHORIZED any more
    expect(t.rail.sends).toBe(1);
  });

  it("Circle FAILED but Arc says paid stays UNKNOWN, never a second payment (S28)", async () => {
    const t = run("FAIL");
    const origSubmit = t.rail.submit.bind(t.rail);
    t.rail.submit = async (p, id) => {
      const r = await origSubmit(p, id);
      t.chain.paid = true;
      return r;
    };
    expect((await t.pay()).status).toBe("UNKNOWN");
    expect(t.repo.status).toBe("PAYING");
  });

  it("Circle FAILED and not paid on Arc -> exception, no retry", async () => {
    const t = run("FAIL");
    expect((await t.pay()).status).toBe("FAILED");
    expect(t.repo.status).toBe("PAYMENT_EXCEPTION");
    expect(t.rail.submits).toBe(1);
  });

  it("still pending after the poll budget stays PAYING", async () => {
    const t = run("PENDING_FOREVER");
    expect((await t.pay()).status).toBe("PENDING");
    expect(t.repo.status).toBe("PAYING");
  });

  it("Circle COMPLETE with a mismatching receipt never settles (S30)", async () => {
    const t = run("OK");
    const origSubmit = t.rail.submit.bind(t.rail);
    t.rail.submit = async (p, id) => {
      const r = await origSubmit(p, id);
      t.chain.goodReceipt("0xtx1", { usdcTransfers: [{ token: USDC, to: RECIPIENT, value: 1n }] });
      return r;
    };
    const out = await t.pay();
    expect(out).toEqual({ status: "MISMATCH", reasons: ["USDC_AMOUNT"] });
    expect(t.repo.status).toBe("PAYMENT_EXCEPTION");
  });
});

describe("S30 settlement matching", () => {
  const exp = { ...expectChain, onchainKey: KEY, recipient: RECIPIENT, amount: 100_000_000n };
  const good = () => ({
    chainId: 5042002,
    success: true,
    guardEvents: [{ address: GUARD, obligationKey: KEY, recipient: RECIPIENT, amount: 100_000_000n }],
    usdcTransfers: [{ token: USDC, to: RECIPIENT, value: 100_000_000n }],
  });

  it("full match", () => expect(matchSettlement(good(), exp)).toEqual([]));
  it("no receipt", () => expect(matchSettlement(null, exp)).toEqual(["NO_RECEIPT"]));
  it("wrong chain", () => expect(matchSettlement({ ...good(), chainId: 1 }, exp)).toContain("WRONG_CHAIN"));
  it("failed tx", () => expect(matchSettlement({ ...good(), success: false }, exp)).toContain("TX_FAILED"));
  it("event from another contract", () => {
    const r = good();
    r.guardEvents[0].address = "0x00000000000000000000000000000000000000ee";
    expect(matchSettlement(r, exp)).toContain("GUARD_EVENT_COUNT");
  });
  it("wrong recipient in guard event", () => {
    const r = good();
    r.guardEvents[0].recipient = "0x00000000000000000000000000000000000000ee";
    expect(matchSettlement(r, exp)).toContain("GUARD_RECIPIENT");
  });
  it("wrong token", () => {
    const r = good();
    r.usdcTransfers[0].token = "0x00000000000000000000000000000000000000ee";
    expect(matchSettlement(r, exp)).toContain("USDC_TRANSFER_COUNT");
  });
  it("a second matching transfer is not silently accepted", () => {
    const r = good();
    r.usdcTransfers.push({ ...r.usdcTransfers[0] });
    expect(matchSettlement(r, exp)).toContain("USDC_TRANSFER_COUNT");
  });
});
