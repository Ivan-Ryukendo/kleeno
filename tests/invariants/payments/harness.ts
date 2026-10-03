import { assertGatePass, type GatePass } from "@/core/payments/gate";
import { computePlanHash, type PlanInput } from "@/core/payments/plan-hash";
import type {
  AttemptState,
  ChainReader,
  ChainReceipt,
  Clock,
  GuardEntry,
  ObligationContext,
  ObligationStatus,
  PaymentRail,
  PaymentsRepo,
  RailStatus,
} from "@/core/ports";

// Synthetic test data only (rule 42).
export const GUARD = "0x00000000000000000000000000000000000000a1";
export const USDC = "0x3600000000000000000000000000000000000000";
export const RECIPIENT = "0x00000000000000000000000000000000000000b2";
export const KEY = "0x" + "11".repeat(32);
export const RUN_KEY = "0x" + "22".repeat(32);

export function baseContext(): ObligationContext {
  const plan: PlanInput = {
    obligations: [{ id: "ob-1", amount: 100_000_000n, recipient: RECIPIENT }],
    heldIds: [],
    source: "FALLBACK",
  };
  return {
    obligation: {
      id: "ob-1",
      companyId: "co-1",
      runId: "run-1",
      batchId: "batch-1",
      amount: 100_000_000n,
      currency: "USDC",
      recipient: RECIPIENT,
      onchainKey: KEY,
      idempotencyKey: "idem-1",
      status: "AUTHORIZED",
    },
    approvedRecipient: RECIPIENT,
    lineAmount: 100_000_000n,
    calculationHash: "hash-a",
    approvalCalculationHash: "hash-a",
    approvalApproverId: "user-payroll",
    run: { id: "run-1", companyId: "co-1", mode: "LIVE_TESTNET", status: "APPROVED" },
    batch: {
      id: "batch-1",
      companyId: "co-1",
      status: "OPEN",
      authorizerId: "user-payment",
      guardRunKey: RUN_KEY,
      planHash: computePlanHash(plan),
      plan,
    },
    company: { id: "co-1", livePaymentsEnabled: true, perPaymentCeiling: 500_000_000n },
    network: "ARC-TESTNET",
    attemptExistsForKey: false,
  };
}

export class FakeRepo implements PaymentsRepo {
  status: ObligationStatus;
  attempts: { id: string; state: AttemptState; circleTxId?: string; key: string }[] = [];
  exception?: { code: string; reasons: string[] };
  txHash?: string;
  constructor(public ctx: ObligationContext) {
    this.status = ctx.obligation.status;
  }
  async loadContext() {
    return {
      ...this.ctx,
      obligation: { ...this.ctx.obligation, status: this.status },
      attemptExistsForKey: this.ctx.attemptExistsForKey || this.attempts.some((a) => a.key === this.ctx.obligation.idempotencyKey),
    };
  }
  async claim() {
    if (this.status !== "AUTHORIZED") return false;
    this.status = "PAYING";
    return true;
  }
  async saveAttempt(a: { idempotencyKey: string }) {
    if (this.attempts.some((x) => x.key === a.idempotencyKey)) throw new Error("unique violation");
    const id = `att-${this.attempts.length + 1}`;
    this.attempts.push({ id, state: "SUBMISSION_PENDING", key: a.idempotencyKey });
    return { attemptId: id };
  }
  async loadAttempt() {
    const a = this.attempts[this.attempts.length - 1];
    return a ? { id: a.id, state: a.state, circleTxId: a.circleTxId ?? null } : null;
  }
  async attachCircleTx(id: string, circleTxId: string) {
    this.attempts.find((a) => a.id === id)!.circleTxId = circleTxId;
  }
  async setAttemptState(id: string, state: AttemptState) {
    this.attempts.find((a) => a.id === id)!.state = state;
  }
  async markSettled(_id: string, txHash: string) {
    this.status = "SETTLED";
    this.txHash = txHash;
  }
  async markException(_id: string, code: string, reasons: string[], from: "AUTHORIZED" | "PAYING") {
    if (this.status !== from) return;
    this.status = "PAYMENT_EXCEPTION";
    this.exception = { code, reasons };
  }
}

export class FakeChain implements ChainReader {
  entry: GuardEntry = { committed: true, runOpen: true, paid: false, runKey: RUN_KEY, recipient: RECIPIENT, amount: 100_000_000n };
  paid = false;
  receipts = new Map<string, ChainReceipt>();
  async guardEntry() {
    return { ...this.entry, paid: this.entry.paid || this.paid };
  }
  async isPaid() {
    return this.paid;
  }
  paidTx: string | null = null; // what the ObligationPaid log lookup finds
  async paymentTx() {
    return this.paid ? this.paidTx : null;
  }
  async receipt(tx: string) {
    return this.receipts.get(tx) ?? null;
  }
  goodReceipt(tx: string, over: Partial<ChainReceipt> = {}) {
    this.receipts.set(tx, {
      chainId: 5042002,
      success: true,
      guardEvents: [{ address: GUARD, obligationKey: KEY, recipient: RECIPIENT, amount: 100_000_000n }],
      usdcTransfers: [{ token: USDC, to: RECIPIENT, value: 100_000_000n }],
      ...over,
    });
  }
}

export type RailScript = "OK" | "THROW_AFTER_SEND" | "FAIL" | "PENDING_FOREVER";

export class FakeRail implements PaymentRail {
  submits = 0;
  sends = 0; // how many times money would actually have moved
  keys = new Map<string, string>(); // Circle idempotency: a repeated key returns the existing transaction
  constructor(private chain: FakeChain, public script: RailScript = "OK") {}
  async submit(pass: GatePass, attemptId?: string) {
    void attemptId;
    assertGatePass(pass);
    this.submits++;
    const seen = this.keys.get(pass.idempotencyKey);
    if (seen) return { circleTxId: seen };
    if (this.script === "FAIL") {
      this.keys.set(pass.idempotencyKey, "c-fail");
      return { circleTxId: "c-fail" };
    }
    this.sends++;
    this.chain.paid = true;
    this.chain.paidTx = "0xtx1";
    this.chain.goodReceipt("0xtx1");
    this.keys.set(pass.idempotencyKey, "c-1"); // the transaction exists even if the answer is lost
    if (this.script === "THROW_AFTER_SEND") throw new Error("timeout");
    return { circleTxId: "c-1" };
  }
  async getStatus(id: string): Promise<RailStatus> {
    if (this.script === "FAIL") return { state: "FAILED" };
    if (this.script === "PENDING_FOREVER") return { state: "PENDING" };
    return id === "c-1" ? { state: "CONFIRMED", txHash: "0xtx1" } : { state: "PENDING" };
  }
}

export const clock: Clock = { now: () => new Date(0), sleep: async () => {} };
export const expectChain = { chainId: 5042002, guardAddress: GUARD, usdcAddress: USDC };
