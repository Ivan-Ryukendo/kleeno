import "server-only";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { parseUsdc } from "@/core/money";
import { checkStanding, MAX_STANDING_AMOUNT, type StandingAuthorization } from "@/core/payments/batches/standing";
import { computePlanHash, type PlanInput } from "@/core/payments/plan-hash";
import { isPaymentRole, WorkflowError, type Role } from "@/core/workflow";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { loadSignalEvidence } from "./signals";

type Who = { companyId: string; userId: string; roles: readonly Role[]; correlationId?: string };
const columns = "id, company_id, created_by, max_batch_total, max_per_payment, expires_at, revoked_at, created_at";
function requireRole(who: Who) {
  if (!isPaymentRole(who.roles)) throw new WorkflowError("FORBIDDEN", "a payment approver is required");
}
export async function listStanding(who: Who) {
  requireRole(who);
  return must(await db().from("standing_authorizations").select(columns).eq("company_id", who.companyId).order("created_at", { ascending: false }), "standing read");
}
export async function createStanding(who: Who, input: { maxBatchTotal: string; maxPerPayment: string; expiresAt: string }) {
  requireRole(who);
  const company = must(await db().from("companies").select("live_payments_enabled, per_payment_ceiling").eq("id", who.companyId).single(), "company read");
  const membership = must(await db().from("memberships").select("roles").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).single(), "membership read");
  if (!isPaymentRole(membership.roles as Role[])) throw new WorkflowError("FORBIDDEN", "the payment role is no longer active");
  if (!company.live_payments_enabled) throw new WorkflowError("LIVE_PAYMENTS_DISABLED", "live payments are off for this company");
  const maxBatchTotal = parseUsdc(input.maxBatchTotal), maxPerPayment = parseUsdc(input.maxPerPayment);
  const expiry = new Date(input.expiresAt);
  if (maxBatchTotal <= 0n || maxBatchTotal > MAX_STANDING_AMOUNT || maxPerPayment <= 0n || maxPerPayment > maxBatchTotal || maxPerPayment > BigInt(company.per_payment_ceiling)) throw new WorkflowError("PLAN_INVALID", "positive limits must respect the batch limit and company payment ceiling");
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) throw new WorkflowError("PLAN_INVALID", "choose a future expiry");
  const row = must(await db().from("standing_authorizations").insert({ company_id: who.companyId, created_by: who.userId, max_batch_total: maxBatchTotal.toString(), max_per_payment: maxPerPayment.toString(), expires_at: expiry.toISOString() }).select(columns).single(), "standing insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "standing.created", entityType: "standing_authorization", entityId: row.id, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId(), refs: { expiresAt: expiry.toISOString() } }));
  return row;
}
export async function revokeStanding(who: Who, id: string) {
  requireRole(who);
  const existing = must(await db().from("standing_authorizations").select("id, revoked_at").eq("company_id", who.companyId).eq("id", id).single(), "standing read");
  if (existing.revoked_at) return { id, revoked: true };
  const changed = must(await db().from("standing_authorizations").update({ revoked_at: new Date().toISOString(), revoked_by: who.userId }).eq("company_id", who.companyId).eq("id", id).is("revoked_at", null).select("id"), "standing revoke");
  if (changed.length) await writeAudit(auditEvent({ companyId: who.companyId, event: "standing.revoked", entityType: "standing_authorization", entityId: id, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId() }));
  return { id, revoked: true };
}

/** Recomputed on authorization, opening, and each gate call. Missing evidence fails closed. */
export async function standingFailures(input: { companyId: string; runId: string; standingId: string; authorizerId: string; plan: PlanInput; planHash: string }) {
  const { companyId, runId, plan } = input;
  const recordResult = await db().from("standing_authorizations").select(columns).eq("company_id", companyId).eq("id", input.standingId).maybeSingle();
  if (recordResult.error) throw new Error("standing read failed");
  const record = recordResult.data;
  if (!record || record.created_by !== input.authorizerId) return ["STANDING_NOT_FOUND"];
  if (plan.source === "FALLBACK") return ["FALLBACK_PLAN"];
  const executionResult = await db().from("ai_executions").select("id, status, operation, input_ref").eq("company_id", companyId).eq("id", plan.source).maybeSingle();
  if (executionResult.error) throw new Error("planner execution read failed");
  const execution = executionResult.data;
  if (!execution || !["ACCEPTED", "REPAIRED"].includes(execution.status) || execution.operation !== "PAYMENT_PLAN" || execution.input_ref !== runId) return ["PLANNER_EXECUTION_INVALID"];
  const company = must(await db().from("companies").select("live_payments_enabled, per_payment_ceiling").eq("id", companyId).single(), "company read");
  const approval = must(await db().from("payroll_approvals").select("approver_id").eq("company_id", companyId).eq("run_id", runId).single(), "approval read");
  const creatorResult = await db().from("memberships").select("roles").eq("company_id", companyId).eq("user_id", record.created_by).is("removed_at", null).maybeSingle();
  if (creatorResult.error) throw new Error("creator read failed");
  const creator = creatorResult.data;
  const evidence = await loadSignalEvidence(companyId, runId);
  const rows = must(await db().from("obligations").select("id, worker_id, amount, recipient, status").eq("company_id", companyId).eq("run_id", runId), "standing obligations read");
  const included = new Set(plan.obligations.map(o => o.id));
  const selected = rows.filter(o => included.has(o.id));
  const workers = must(await db().from("workers").select("id, wallet_address, wallet_confirmed_address").eq("company_id", companyId).in("id", selected.map(o => o.worker_id)), "standing recipients read");
  const recipients = new Map(workers.map(w => [w.id, w.wallet_address && w.wallet_address.toLowerCase() === w.wallet_confirmed_address?.toLowerCase() ? w.wallet_address.toLowerCase() : null]));
  const failures: string[] = [];
  if (computePlanHash(plan) !== input.planHash || selected.length !== plan.obligations.length || plan.obligations.some(p => !selected.some(o => o.id === p.id && BigInt(o.amount) === p.amount && o.recipient.toLowerCase() === p.recipient.toLowerCase()))) failures.push("PLAN_INVALID");
  const standing: StandingAuthorization = { companyId: record.company_id, id: record.id, createdBy: record.created_by, maxBatchTotal: BigInt(record.max_batch_total), maxPerPayment: BigInt(record.max_per_payment), expiresAt: new Date(record.expires_at), revokedAt: record.revoked_at ? new Date(record.revoked_at) : null };
  failures.push(...checkStanding({ standing, plan, signalCount: evidence.signals.length, companyCeiling: BigInt(company.per_payment_ceiling), payrollApproverId: approval.approver_id, now: new Date(), companyId, sameConfigVersion: evidence.previousConfigVersion !== null && evidence.previousConfigVersion === evidence.configVersion, recipientChanged: selected.some(o => recipients.get(o.worker_id) !== o.recipient.toLowerCase()), hasExistingHolds: rows.some(o => o.status === "ON_HOLD"), creatorHasPaymentRole: !!creator && isPaymentRole(creator.roles as Role[]), livePaymentsEnabled: company.live_payments_enabled }));
  return failures;
}
