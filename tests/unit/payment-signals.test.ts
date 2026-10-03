import { describe, expect, it } from "vitest";
import { planObligations, type ApprovedLine } from "@/core/payments/obligations";
import { computeSignals, type PastPayment } from "@/core/payments/signals";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const line = (over: Partial<ApprovedLine> = {}): ApprovedLine => ({ lineId: "l1", workerId: "w1", pseudonym: "W001", net: 100n, wallet: A, confirmedWallet: A, ...over });

describe("planObligations", () => {
  it("creates a draft for a confirmed wallet and skips zero-net lines", () => {
    const p = planObligations([line(), line({ lineId: "l2", workerId: "w2", net: 0n })]);
    expect(p.drafts).toEqual([{ lineId: "l1", workerId: "w1", amount: 100n, recipient: A }]);
    expect(p.blocked).toEqual([]);
  });
  it("blocks a missing, unconfirmed or differently confirmed wallet; a case-only difference still matches", () => {
    const p = planObligations([
      line({ wallet: null }),
      line({ workerId: "w2", confirmedWallet: null }),
      line({ workerId: "w3", confirmedWallet: B }),
      line({ workerId: "w4", wallet: "0x" + "A".repeat(40), confirmedWallet: A }),
    ]);
    expect(p.blocked.map((b) => b.reason)).toEqual(["NO_WALLET", "RECIPIENT_UNCONFIRMED", "RECIPIENT_UNCONFIRMED"]);
    expect(p.drafts).toHaveLength(1);
  });
});

describe("computeSignals", () => {
  const ob = (amount: bigint, recipient = A) => ({ id: "o1", workerId: "w1", amount, recipient });
  const hist = (...amounts: bigint[]): Map<string, PastPayment[]> => new Map([["w1", amounts.map((amount) => ({ amount, recipient: A }))]]);
  const sig = (obligation: ReturnType<typeof ob>, history: Map<string, PastPayment[]>, previous: number | null = 1) =>
    computeSignals({ obligations: [obligation], history, configVersion: 1, previousConfigVersion: previous }).map((s) => s.code);

  it("FIRST_PAYMENT when there is no settled history", () => expect(sig(ob(100n), new Map())).toEqual(["FIRST_PAYMENT"]));
  it("AMOUNT_RATIO at exactly 2x and exactly 0.5x the mean of the last three, not inside", () => {
    expect(sig(ob(200n), hist(100n, 100n, 100n))).toEqual(["AMOUNT_RATIO"]);
    expect(sig(ob(50n), hist(100n, 100n, 100n))).toEqual(["AMOUNT_RATIO"]);
    expect(sig(ob(199n), hist(100n, 100n, 100n))).toEqual([]);
    expect(sig(ob(51n), hist(100n, 100n, 100n))).toEqual([]);
  });
  it("only the three newest settled payments count", () => expect(sig(ob(200n), hist(200n, 200n, 200n, 1n))).toEqual([]));
  it("RECIPIENT_CHANGED when the newest settled recipient differs", () => expect(sig(ob(100n, B), hist(100n))).toEqual(["RECIPIENT_CHANGED"]));
  it("CONFIG_VERSION_CHANGED is run-level and needs a previous settled run", () => {
    expect(computeSignals({ obligations: [], history: new Map(), configVersion: 2, previousConfigVersion: 1 })).toEqual([{ id: "CONFIG_VERSION_CHANGED", code: "CONFIG_VERSION_CHANGED", obligationId: null }]);
    expect(computeSignals({ obligations: [], history: new Map(), configVersion: 2, previousConfigVersion: null })).toEqual([]);
  });
  it("is deterministic", () => {
    const i = { obligations: [ob(300n)], history: hist(100n), configVersion: 1, previousConfigVersion: 1 };
    expect(computeSignals(i)).toEqual(computeSignals(i));
  });
});
