// PROTECTED. S28 (failure matrix), S29 (crash points 1-5), S05 (recovery keeps reading while payments are off), S27/S30 (Arc decides).
import { describe, expect, it } from "vitest";
import { resumeObligation } from "@/core/payments/agent";
import { batchComplete, runOutcome } from "@/core/payments/rollup";
import type { ObligationContext } from "@/core/ports";
import { baseContext, clock, expectChain, FakeChain, FakeRail, FakeRepo } from "./harness";

type Stuck = ReturnType<typeof stuck>;

/** An obligation already claimed (PAYING) with whatever the crash left behind. */
function stuck(over: { attempt?: { state: "SUBMISSION_PENDING" | "SUBMITTED" | "UNKNOWN"; circleTxId?: string }; script?: ConstructorParameters<typeof FakeRail>[1]; mutate?: (c: ObligationContext) => void } = {}) {
  const ctx = baseContext();
  ctx.obligation.status = "PAYING";
  const chain = new FakeChain();
  const rail = new FakeRail(chain, over.script ?? "OK");
  over.mutate?.(ctx);
  const repo = new FakeRepo(ctx);
  if (over.attempt) repo.attempts.push({ id: "att-1", state: over.attempt.state, key: ctx.obligation.idempotencyKey, circleTxId: over.attempt.circleTxId });
  const resume = () => resumeObligation("ob-1", { repo, chain, rail, clock, expect: expectChain, maxPolls: 3 });
  return { repo, chain, rail, resume };
}

/** The payment already went through on Arc (the crash happened after the transaction). */
const moneyMoved = (t: Stuck) => {
  t.chain.paid = true;
  t.chain.paidTx = "0xtx1";
  t.chain.goodReceipt("0xtx1");
  t.rail.sends = 1;
  t.rail.keys.set("idem-1", "c-1");
};

describe("S29 crash points: recovery ends with one payment and one SETTLED obligation", () => {
  it("(1) crash before the Circle call: no attempt, nothing paid -> submits once under the obligation key", async () => {
    const t = stuck();
    expect((await t.resume()).status).toBe("SETTLED");
    expect(t.rail.sends).toBe(1);
    expect(t.repo.attempts).toHaveLength(1);
    expect(t.repo.attempts[0].key).toBe("idem-1");
    expect(t.repo.status).toBe("SETTLED");
  });

  it("(2) crash after the call, before its answer, Circle never got it: resubmits with the SAME key, one payment", async () => {
    const t = stuck({ attempt: { state: "SUBMISSION_PENDING" } });
    expect((await t.resume()).status).toBe("SETTLED");
    expect(t.rail.sends).toBe(1);
    expect(t.repo.attempts).toHaveLength(1);
  });

  it("(2) same crash but the payment went through: Arc says paid, so nothing is sent again", async () => {
    const t = stuck({ attempt: { state: "SUBMISSION_PENDING" } });
    moneyMoved(t);
    expect(await t.resume()).toEqual({ status: "SETTLED", txHash: "0xtx1" });
    expect(t.rail.submits).toBe(0);
    expect(t.rail.sends).toBe(1);
    expect(t.repo.status).toBe("SETTLED");
  });

  it("(3) crash after Circle answered, before the DB write: the attempt names the Circle tx and recovery settles from Arc", async () => {
    const t = stuck({ attempt: { state: "SUBMISSION_PENDING", circleTxId: "c-1" } });
    moneyMoved(t);
    expect((await t.resume()).status).toBe("SETTLED");
    expect(t.rail.submits).toBe(0);
    expect(t.repo.attempts[0].state).toBe("CONFIRMED");
  });

  it("(4)(5) chain transaction done, webhook never came or came before settlement: same recovery, still one payment", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-1" } });
    moneyMoved(t);
    expect((await t.resume()).status).toBe("SETTLED");
    expect((await t.resume()).status).toBe("NOT_CLAIMED"); // a second recovery is a no-op
    expect(t.rail.sends).toBe(1);
  });

  it("paid on Arc with no Circle record: the ObligationPaid log finds the transaction", async () => {
    const t = stuck({ attempt: { state: "UNKNOWN" } });
    moneyMoved(t);
    expect((await t.resume()).status).toBe("SETTLED");
  });
});

describe("S28 failure matrix on recovery", () => {
  it("paid on Arc but no transaction can be found: stays PAYING and UNKNOWN, never resent", async () => {
    const t = stuck({ attempt: { state: "UNKNOWN" } });
    moneyMoved(t);
    t.chain.paidTx = null;
    expect((await t.resume()).status).toBe("UNKNOWN");
    expect(t.repo.status).toBe("PAYING");
    expect(t.rail.submits).toBe(0);
  });

  it("Circle FAILED and nothing paid on Arc: an exception, not an automatic second attempt", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-fail" }, script: "FAIL" });
    expect((await t.resume()).status).toBe("FAILED");
    expect(t.repo.status).toBe("PAYMENT_EXCEPTION");
    expect(t.rail.submits).toBe(0);
  });

  it("Circle FAILED but Arc says paid: the money moved, so it settles", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-fail" }, script: "FAIL" });
    moneyMoved(t);
    expect((await t.resume()).status).toBe("SETTLED");
  });

  it("a receipt that does not match never settles", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-1" } });
    moneyMoved(t);
    t.chain.goodReceipt("0xtx1", { usdcTransfers: [] });
    expect((await t.resume()).status).toBe("MISMATCH");
    expect(t.repo.exception?.code).toBe("SETTLEMENT_MISMATCH");
  });

  it("a receipt that cannot be read yet leaves it PAYING for the next pass", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-1" } });
    moneyMoved(t);
    t.chain.receipt = async () => {
      throw new Error("rpc down");
    };
    expect((await t.resume()).status).toBe("PENDING");
    expect(t.repo.status).toBe("PAYING");
    expect(t.repo.exception).toBeUndefined();
  });

  it("still pending at Circle after the poll budget: stays PAYING", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-9" }, script: "PENDING_FOREVER" });
    expect((await t.resume()).status).toBe("PENDING");
    expect(t.repo.status).toBe("PAYING");
  });

  it("an obligation that is not PAYING is left alone", async () => {
    const t = stuck({ mutate: (c) => (c.obligation.status = "SETTLED") });
    expect((await t.resume()).status).toBe("NOT_CLAIMED");
    expect(t.rail.submits).toBe(0);
  });

  it("another failed gate check (recipient changed since approval) -> exception, nothing sent", async () => {
    const t = stuck({ mutate: (c) => (c.approvedRecipient = "0x00000000000000000000000000000000000000ff") });
    expect(await t.resume()).toMatchObject({ status: "BLOCKED", failures: ["RECIPIENT_MISMATCH"] });
    expect(t.repo.status).toBe("PAYMENT_EXCEPTION");
    expect(t.rail.submits).toBe(0);
  });
});

describe("S05 the kill switch pauses sending but not reading", () => {
  const off = (c: ObligationContext) => (c.company.livePaymentsEnabled = false);

  it("live payments OFF and nothing paid: no submission and no exception; it resumes when payments are back on", async () => {
    const t = stuck({ mutate: off });
    expect(await t.resume()).toEqual({ status: "BLOCKED", failures: ["LIVE_PAYMENTS_OFF"] });
    expect(t.repo.status).toBe("PAYING");
    expect(t.rail.submits).toBe(0);
    t.repo.ctx.company.livePaymentsEnabled = true;
    expect((await t.resume()).status).toBe("SETTLED");
  });

  it("live payments OFF but the money already moved: recovery still records the settlement", async () => {
    const t = stuck({ attempt: { state: "SUBMITTED", circleTxId: "c-1" }, mutate: off });
    moneyMoved(t);
    expect((await t.resume()).status).toBe("SETTLED");
  });
});

describe("rollup decisions", () => {
  it("anything still moving keeps the run in progress", () => {
    expect(runOutcome(["SETTLED", "PAYING"])).toBe("IN_PROGRESS");
    expect(runOutcome(["SETTLED", "AUTHORIZED"])).toBe("IN_PROGRESS");
  });
  it("settled / failed / partial", () => {
    expect(runOutcome(["SETTLED", "SETTLED"])).toBe("SETTLED");
    expect(runOutcome(["SETTLED", "PAYMENT_EXCEPTION", "ON_HOLD"])).toBe("PAYMENT_FAILED");
    expect(runOutcome(["SETTLED", "ON_HOLD"])).toBe("PARTIALLY_SETTLED");
    expect(runOutcome(["SETTLED", "CREATED"])).toBe("PARTIALLY_SETTLED");
  });
  it("a batch completes only when everything in it settled", () => {
    expect(batchComplete(["SETTLED", "SETTLED"])).toBe(true);
    expect(batchComplete(["SETTLED", "PAYMENT_EXCEPTION"])).toBe(false);
    expect(batchComplete([])).toBe(false);
  });
});
