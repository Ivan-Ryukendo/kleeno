import "server-only";
import { newCorrelationId } from "@/core/audit";
import type { AttemptState, ObligationContext, PaymentsRepo } from "@/core/ports";
import { standingFailures } from "./standing";
import { db, must } from "./client";

// bigint columns arrive as JSON numbers; safe far beyond any testnet amount (< 2^53 micro-USDC).
const big = (n: number | string) => BigInt(n);

async function audit(correlationId: string, companyId: string, event: string, obligationId: string, refs: Record<string, unknown> = {}) {
  // references only, never payroll values (S45)
  must(
    await db().from("audit_events").insert({ company_id: companyId, event, entity_type: "obligation", entity_id: obligationId, actor: "system", correlation_id: correlationId, refs }).select("id"),
    "audit insert",
  );
}

export function paymentsRepo(correlationId = newCorrelationId()): PaymentsRepo {
  return {
    async loadContext(obligationId): Promise<ObligationContext | null> {
      const o = (await db().from("obligations").select("*").eq("id", obligationId).maybeSingle()).data;
      if (!o) return null;
      const cid = o.company_id as string;
      const [run, batch, line, company, approval, worker, attempts] = await Promise.all([
        db().from("payroll_runs").select("*").eq("id", o.run_id).maybeSingle(),
        o.batch_id ? db().from("payment_batches").select("*").eq("id", o.batch_id).maybeSingle() : Promise.resolve({ data: null }),
        db().from("calculation_lines").select("net, calculation_id").eq("id", o.calculation_line_id).maybeSingle(),
        db().from("companies").select("id, live_payments_enabled, per_payment_ceiling").eq("id", cid).maybeSingle(),
        db().from("payroll_approvals").select("calculation_hash, approver_id").eq("id", o.approval_id).maybeSingle(),
        db().from("workers").select("wallet_address").eq("id", o.worker_id).maybeSingle(),
        db().from("payment_attempts").select("id", { count: "exact", head: true }).eq("idempotency_key", o.idempotency_key),
      ]);
      if (!run.data || !line.data || !company.data || !approval.data || !worker.data) return null;
      const calc = (await db().from("calculations").select("calculation_hash").eq("id", line.data.calculation_id).maybeSingle()).data;
      if (!calc) return null;
      const b = batch.data as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
      let standingValid = false;
      if (b?.authorization_type === "STANDING" && b.standing_authorization_id && b.authorizer_id) {
        try {
          standingValid = (await standingFailures({ companyId: cid, runId: o.run_id, standingId: b.standing_authorization_id, authorizerId: b.authorizer_id, planHash: b.plan_hash, plan: { obligations: b.plan.obligations.map((p: { id: string; amount: string; recipient: string }) => ({ ...p, amount: big(p.amount) })), heldIds: b.plan.heldIds, source: b.plan.source } })).length === 0;
        } catch { standingValid = false; }
      }
      return {
        obligation: {
          id: o.id,
          companyId: cid,
          runId: o.run_id,
          batchId: o.batch_id,
          amount: big(o.amount),
          currency: o.currency,
          recipient: o.recipient,
          onchainKey: o.onchain_key,
          idempotencyKey: o.idempotency_key,
          status: o.status,
        },
        // Fail closed: if the worker's wallet changed after approval, it no longer matches the obligation.
        approvedRecipient: worker.data.wallet_address,
        lineAmount: big(line.data.net),
        calculationHash: calc.calculation_hash,
        approvalCalculationHash: approval.data.calculation_hash,
        approvalApproverId: approval.data.approver_id,
        run: { id: run.data.id, companyId: run.data.company_id, mode: run.data.mode, status: run.data.status },
        batch: b && {
          id: b.id,
          companyId: b.company_id,
          status: b.status,
          authorizerId: b.authorizer_id,
          authorizationType: b.authorization_type,
          standingValid,
          guardRunKey: b.guard_run_key,
          planHash: b.plan_hash,
          // Only the hashed fields: the stored plan also carries display-only signals, which are not part of plan_hash.
          plan: {
            obligations: b.plan.obligations.map((p: { id: string; amount: string; recipient: string }) => ({ ...p, amount: big(p.amount) })),
            heldIds: b.plan.heldIds,
            source: b.plan.source,
          },
        },
        company: { id: company.data.id, livePaymentsEnabled: company.data.live_payments_enabled, perPaymentCeiling: big(company.data.per_payment_ceiling) },
        network: o.network,
        attemptExistsForKey: (attempts.count ?? 0) > 0,
      };
    },

    async claim(obligationId) {
      const res = await db().from("obligations").update({ status: "PAYING" }).eq("id", obligationId).eq("status", "AUTHORIZED").select("id, company_id");
      const row = must(res, "claim")[0];
      if (row) await audit(correlationId, row.company_id, "OBLIGATION_PAYING", obligationId);
      return !!row;
    },

    async saveAttempt({ obligationId, companyId, idempotencyKey }) {
      const res = await db().from("payment_attempts").insert({ company_id: companyId, obligation_id: obligationId, idempotency_key: idempotencyKey, state: "SUBMISSION_PENDING" }).select("id").single();
      return { attemptId: must(res, "attempt insert").id };
    },

    async loadAttempt(obligationId) {
      const a = (await db().from("payment_attempts").select("id, state, circle_tx_id").eq("obligation_id", obligationId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
      return a ? { id: a.id, state: a.state, circleTxId: a.circle_tx_id } : null;
    },

    async attachCircleTx(attemptId, circleTxId) {
      must(await db().from("payment_attempts").update({ circle_tx_id: circleTxId, updated_at: new Date().toISOString() }).eq("id", attemptId).select("id"), "attempt update");
    },

    async setAttemptState(attemptId, state: AttemptState) {
      must(await db().from("payment_attempts").update({ state, updated_at: new Date().toISOString() }).eq("id", attemptId).select("id"), "attempt state");
    },

    async markSettled(obligationId, txHash) {
      const rows = must(await db().from("obligations").update({ status: "SETTLED", tx_hash: txHash }).eq("id", obligationId).eq("status", "PAYING").select("company_id"), "settle");
      if (rows[0]) await audit(correlationId, rows[0].company_id, "OBLIGATION_SETTLED", obligationId, { txHash });
    },

    async markException(obligationId, code, reasons, from) {
      const rows = must(
        await db().from("obligations").update({ status: "PAYMENT_EXCEPTION", exception_code: code, exception_reasons: reasons }).eq("id", obligationId).eq("status", from).select("company_id"),
        "exception",
      );
      if (rows[0]) await audit(correlationId, rows[0].company_id, "PAYMENT_EXCEPTION", obligationId, { code, reasons });
    },
  };
}
