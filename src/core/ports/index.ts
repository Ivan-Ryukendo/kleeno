import type { GatePass } from "../payments/gate";
import type { PlanInput } from "../payments/plan-hash";

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export type RunMode = "SIMULATION" | "LIVE_TESTNET";
export type ObligationStatus = "CREATED" | "AUTHORIZED" | "ON_HOLD" | "PAYING" | "SETTLED" | "PAYMENT_EXCEPTION";

/** Everything the gate needs, loaded from the DB by obligation ID only (rule 20/21). */
export interface ObligationContext {
  obligation: {
    id: string;
    companyId: string;
    runId: string;
    batchId: string | null;
    amount: bigint;
    currency: string;
    recipient: string;
    onchainKey: string;
    idempotencyKey: string;
    status: ObligationStatus;
  };
  approvedRecipient: string; // snapshot taken at payroll approval
  lineAmount: bigint; // net of this obligation's calculation line
  calculationHash: string; // hash stored on the calculation
  approvalCalculationHash: string; // hash the payroll approval bound
  approvalApproverId: string; // from the immutable payroll_approvals row (four-eyes reference)
  run: { id: string; companyId: string; mode: RunMode; status: string };
  batch: {
    id: string;
    companyId: string;
    status: string;
    authorizerId: string | null;
    guardRunKey: string | null;
    planHash: string;
    plan: PlanInput;
  } | null;
  company: { id: string; livePaymentsEnabled: boolean; perPaymentCeiling: bigint };
  network: string;
  attemptExistsForKey: boolean;
}

export type AttemptState = "SUBMISSION_PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export interface PaymentsRepo {
  loadContext(obligationId: string): Promise<ObligationContext | null>;
  /** Compare-and-set AUTHORIZED -> PAYING. True only for the single claimant. */
  claim(obligationId: string): Promise<boolean>;
  /** Saved BEFORE the Circle call. Unique on idempotency key. */
  saveAttempt(a: { obligationId: string; companyId: string; idempotencyKey: string }): Promise<{ attemptId: string }>;
  attachCircleTx(attemptId: string, circleTxId: string): Promise<void>;
  setAttemptState(attemptId: string, state: AttemptState): Promise<void>;
  markSettled(obligationId: string, txHash: string): Promise<void>;
  /** Moves the obligation to PAYMENT_EXCEPTION only if it is still in `from` (never touches SETTLED or a concurrent claimant). */
  markException(obligationId: string, code: string, reasons: string[], from: "AUTHORIZED" | "PAYING"): Promise<void>;
}

export interface RailStatus {
  state: "PENDING" | "CONFIRMED" | "FAILED";
  txHash?: string;
}

export interface PaymentRail {
  /** Accepts only a pass issued by the gate. */
  submit(pass: GatePass, attemptId: string): Promise<{ circleTxId: string }>;
  getStatus(circleTxId: string): Promise<RailStatus>;
}

export interface GuardEntry {
  committed: boolean;
  runOpen: boolean;
  paid: boolean;
  /** What the guard itself will pay: the gate checks these against the DB before any money moves. */
  runKey: string;
  recipient: string;
  amount: bigint;
}

export interface ChainReceipt {
  chainId: number;
  success: boolean;
  /** ObligationPaid events from any address; the matcher checks the address. */
  guardEvents: { address: string; obligationKey: string; recipient: string; amount: bigint }[];
  /** ERC-20 Transfer logs (6-dp); the 18-dp system log is filtered out by the reader. */
  usdcTransfers: { token: string; to: string; value: bigint }[];
}

export interface ChainReader {
  guardEntry(onchainKey: string): Promise<GuardEntry>;
  isPaid(onchainKey: string): Promise<boolean>;
  receipt(txHash: string): Promise<ChainReceipt | null>;
}
