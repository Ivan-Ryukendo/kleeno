import { RUN_APPROVED_OR_LATER as RUN_APPROVED_OR_LATER_STATES } from "../domain/machines";
import type { ChainReader, PaymentsRepo } from "../ports";
import { computePlanHash } from "./plan-hash";

declare const passBrand: unique symbol;

/** The only value PaymentRail.submit accepts. Only `runGate` creates one (rule 20). */
export interface GatePass {
  readonly [passBrand]: true;
  readonly obligationId: string;
  readonly companyId: string;
  readonly amount: bigint;
  readonly recipient: string;
  readonly onchainKey: string;
  readonly idempotencyKey: string;
}

const issued = new WeakSet<object>();

/** Rails call this first: a hand-built object is rejected at runtime, not just by types. */
export function assertGatePass(pass: GatePass): void {
  if (!issued.has(pass)) throw new Error("payment rejected: not a gate pass");
}

export type GateResult = { ok: true; pass: GatePass } | { ok: false; failures: string[] };

const RUN_APPROVED_OR_LATER = new Set<string>(RUN_APPROVED_OR_LATER_STATES);
const BATCH_PAYABLE = new Set(["AUTHORIZED", "OPEN"]);

/**
 * The single safety gate. Re-reads everything by obligation ID; any failed check = DO NOT PAY.
 * `resume` is for recovery of an obligation already claimed (PAYING) whose attempt exists: it expects PAYING and skips only the
 * "idempotency key unused" check (the saved attempt is that key). Every other check still runs, kill switch included.
 */
export async function runGate(obligationId: string, repo: PaymentsRepo, chain: ChainReader, opts: { resume?: boolean } = {}): Promise<GateResult> {
  const ctx = await repo.loadContext(obligationId);
  if (!ctx) return { ok: false, failures: ["OBLIGATION_NOT_FOUND"] };
  const { obligation: o, run, batch, company } = ctx;

  const guard = await chain.guardEntry(o.onchainKey);
  const checks: [string, boolean][] = [
    [opts.resume ? "OBLIGATION_NOT_PAYING" : "OBLIGATION_NOT_AUTHORIZED", o.status === (opts.resume ? "PAYING" : "AUTHORIZED")],
    ["COMPANY_MISMATCH", run.companyId === o.companyId && company.id === o.companyId && !!batch && batch.companyId === o.companyId],
    ["RUN_MISMATCH", run.id === o.runId],
    ["NOT_IN_BATCH", !!batch && batch.id === o.batchId && BATCH_PAYABLE.has(batch.status)],
    ["PLAN_HASH_MISMATCH", !!batch && computePlanHash(batch.plan) === batch.planHash],
    ["NOT_IN_PLAN", !!batch && batch.plan.obligations.some((p) => p.id === o.id && p.amount === o.amount && p.recipient === o.recipient)],
    ["AUTHORIZER_MISSING", !!batch && !!batch.authorizerId],
    ["STANDING_NOT_VALID", batch?.authorizationType !== "STANDING" || batch.standingValid === true],
    ["SAME_USER_APPROVAL", !!batch && !!batch.authorizerId && batch.authorizerId !== ctx.approvalApproverId],
    ["RUN_NOT_LIVE", run.mode === "LIVE_TESTNET"],
    ["RUN_NOT_APPROVED", RUN_APPROVED_OR_LATER.has(run.status)],
    ["LIVE_PAYMENTS_OFF", company.livePaymentsEnabled],
    ["CALCULATION_HASH_MISMATCH", ctx.calculationHash === ctx.approvalCalculationHash],
    ["AMOUNT_MISMATCH", o.amount === ctx.lineAmount && o.amount > 0n],
    ["NOT_USDC", o.currency === "USDC"],
    ["NOT_ARC_TESTNET", ctx.network === "ARC-TESTNET"],
    ["RECIPIENT_MISMATCH", o.recipient.toLowerCase() === ctx.approvedRecipient.toLowerCase()],
    ["IDEMPOTENCY_KEY_USED", !!opts.resume || !ctx.attemptExistsForKey],
    ["OVER_CEILING", o.amount <= company.perPaymentCeiling],
    ["NOT_COMMITTED_ON_GUARD", guard.committed && guard.runOpen],
    ["ALREADY_PAID_ON_GUARD", !guard.paid],
    // The guard pays what was committed, so what was committed must be what the DB approved.
    ["GUARD_RECIPIENT_MISMATCH", guard.recipient.toLowerCase() === o.recipient.toLowerCase()],
    ["GUARD_AMOUNT_MISMATCH", guard.amount === o.amount],
    ["GUARD_RUN_MISMATCH", !!batch?.guardRunKey && guard.runKey.toLowerCase() === batch.guardRunKey.toLowerCase()],
  ];
  const failures = checks.filter(([, pass]) => !pass).map(([code]) => code);
  if (failures.length) return { ok: false, failures };

  const pass = Object.freeze({
    obligationId: o.id,
    companyId: o.companyId,
    amount: o.amount,
    recipient: o.recipient,
    onchainKey: o.onchainKey,
    idempotencyKey: o.idempotencyKey,
  }) as unknown as GatePass;
  issued.add(pass);
  return { ok: true, pass };
}
