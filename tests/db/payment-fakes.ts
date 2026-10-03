// Fakes for the chain, Circle and the approver wallet, so DB tests run the real repositories and gate without touching Circle or Arc.
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";
import { assertGatePass, type GatePass } from "@/core/payments/gate";
import type { AgentDeps } from "@/core/payments/agent";
import type { ChainReader, ChainReceipt, GuardEntry, PaymentRail, RailStatus } from "@/core/ports";
import type { OwnerPort } from "@/server/db/batches";
import { paymentsRepo } from "@/server/db/payments-repo";
import { ADDR, admin } from "./helpers";

export const GUARD = ADDR(0x6a4d);
export const USDC = "0x3600000000000000000000000000000000000000";

/** The approver wallet and the guard's owner calls. */
export class FakePort implements OwnerPort {
  balance = 1_000_000_000_000_000_000n;
  opened = 0;
  failOpen = false;
  closed: string[] = [];
  committed = new Map<string, string>(); // onchain key -> run key
  usdcBalance = async () => this.balance;
  runKeyFor = (id: string) => keccak256(toHex(id));
  async guardEntry(key: string): Promise<GuardEntry> {
    const runKey = this.committed.get(key);
    return { committed: !!runKey, runOpen: !!runKey, paid: false, runKey: runKey ?? `0x${"0".repeat(64)}`, recipient: ADDR(1), amount: 0n };
  }
  async openRun(batchId: string, obs: { onchainKey: string }[]) {
    if (this.failOpen) throw new Error("circle is down");
    this.opened++;
    for (const o of obs) this.committed.set(o.onchainKey, this.runKeyFor(batchId));
  }
  async closeRun(batchId: string) {
    this.closed.push(batchId);
  }
}

/** Arc, as the guard sees it: what was committed at openRun, what has been paid, and the receipts. */
export class DbChain implements ChainReader {
  entries = new Map<string, { runKey: string; recipient: string; amount: bigint }>();
  paid = new Set<string>();
  txs = new Map<string, string>(); // onchain key -> tx hash
  receipts = new Map<string, ChainReceipt>();
  async guardEntry(key: string): Promise<GuardEntry> {
    const e = this.entries.get(key);
    return e ? { committed: true, runOpen: true, paid: this.paid.has(key), ...e } : { committed: false, runOpen: false, paid: false, runKey: `0x${"0".repeat(64)}`, recipient: ADDR(0), amount: 0n };
  }
  isPaid = async (key: string) => this.paid.has(key);
  paymentTx = async (key: string) => (this.paid.has(key) ? (this.txs.get(key) ?? null) : null);
  receipt = async (tx: string) => this.receipts.get(tx) ?? null;
  /** Mirrors openRun for an OPEN batch, reading what the database committed. */
  async commitBatch(batchId: string) {
    const b = (await admin.from("payment_batches").select("guard_run_key").eq("id", batchId).single()).data!;
    const obs = (await admin.from("obligations").select("onchain_key, recipient, amount").eq("batch_id", batchId)).data!;
    for (const o of obs) this.entries.set(o.onchain_key, { runKey: b.guard_run_key, recipient: o.recipient, amount: BigInt(o.amount) });
  }
}

export type DbRailScript = "OK" | "THROW_AFTER_SEND" | "FAIL" | "PENDING_UNTIL_CONFIRMED";

/** Circle plus the guard's pay(): idempotent per key, and it moves "money" on the fake chain. */
export class DbRail implements PaymentRail {
  sends = 0;
  submits = 0;
  keys = new Map<string, string>();
  txOf = new Map<string, string>(); // circle tx id -> tx hash
  failKeys = new Set<string>(); // onchain keys whose payment Circle fails
  failedTx = new Set<string>(); // Circle tx ids that report FAILED
  confirmed = true;
  constructor(private chain: DbChain, public script: DbRailScript = "OK") {}
  async submit(pass: GatePass) {
    assertGatePass(pass);
    this.submits++;
    const seen = this.keys.get(pass.idempotencyKey);
    if (seen) return { circleTxId: seen };
    const circleTxId = randomUUID(); // Circle ids are UUIDs and unique across the database
    this.keys.set(pass.idempotencyKey, circleTxId);
    if (this.failKeys.has(pass.onchainKey) || this.script === "FAIL") {
      this.failedTx.add(circleTxId);
      return { circleTxId };
    }
    this.sends++;
    const hash = `0x${this.sends.toString(16).padStart(64, "0")}`;
    this.chain.paid.add(pass.onchainKey);
    this.chain.txs.set(pass.onchainKey, hash);
    this.txOf.set(circleTxId, pass.onchainKey);
    this.chain.receipts.set(hash, {
      chainId: 5042002,
      success: true,
      guardEvents: [{ address: GUARD, obligationKey: pass.onchainKey, recipient: pass.recipient, amount: pass.amount }],
      usdcTransfers: [{ token: USDC, to: pass.recipient, value: pass.amount }],
    });
    if (this.script === "THROW_AFTER_SEND") throw new Error("timeout");
    if (this.script === "PENDING_UNTIL_CONFIRMED") this.confirmed = false;
    return { circleTxId };
  }
  async getStatus(circleTxId: string): Promise<RailStatus> {
    if (this.failedTx.has(circleTxId)) return { state: "FAILED" };
    const key = this.txOf.get(circleTxId);
    if (!key || !this.confirmed) return { state: "PENDING" };
    return { state: "CONFIRMED", txHash: this.chain.txs.get(key) };
  }
}

export function agentDepsFor(chain: DbChain, rail: DbRail): AgentDeps {
  return { repo: paymentsRepo(), chain, rail, clock: { now: () => new Date(), sleep: async () => {} }, expect: { chainId: 5042002, guardAddress: GUARD, usdcAddress: USDC }, maxPolls: 2 };
}
