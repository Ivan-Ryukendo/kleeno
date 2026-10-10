import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditEvent } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import type { PayType } from "@/core/engine";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { WorkerMetadataSchema, type WorkerMetadata } from "@/core/workers";
import { openJson, sealJson } from "@/server/crypto";
import { writeAudit } from "./audit";
import { db, must } from "./client";

// Compensation is encrypted at rest (S41): { baseAmount, hourlyRate } as micro-USDC strings, versioned and immutable.
export interface Compensation {
  baseAmount: bigint;
  hourlyRate: bigint;
}
export const COMP_REASONS = ["PROMOTION", "RAISE", "ROLE_CHANGE", "CORRECTION"] as const;
export const LEFT_REASONS = ["RESIGNED", "TERMINATED", "CONTRACT_ENDED", "OTHER"] as const;
export type CompReason = (typeof COMP_REASONS)[number] | "INITIAL";
export type LeftReason = (typeof LEFT_REASONS)[number];
interface Who {
  companyId: string;
  userId: string;
  correlationId: string;
  roles?: readonly Role[];
}

async function insertCompensation(who: Who, workerId: string, version: number, c: Compensation, reason: CompReason) {
  const id = randomUUID();
  const payload = await sealJson(who.companyId, "compensations", "payload_enc", id, { baseAmount: c.baseAmount, hourlyRate: c.hourlyRate });
  must(await db().from("compensations").insert({ id, company_id: who.companyId, worker_id: workerId, version, payload_enc: payload, created_by: who.userId, reason }).select("id"), "compensation insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "compensation.version", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { version, reason } }));
}

export async function createWorker(who: Who, input: { pseudonym: string; payType: PayType; compensation: Compensation; metadata?: WorkerMetadata }) {
  const id = randomUUID();
  const metadata = WorkerMetadataSchema.parse(input.metadata ?? {});
  const metadata_enc = await sealJson(who.companyId, "workers", "metadata_enc", id, metadata);
  must(await db().from("workers").insert({ id, company_id: who.companyId, pseudonym: input.pseudonym, pay_type: input.payType, metadata_enc, employment_start: metadata.employmentStart, employment_end: metadata.employmentEnd }).select("id"), "worker insert"); // unique (company, pseudonym)
  try {
    await insertCompensation(who, id, 1, input.compensation, "INITIAL");
  } catch (e) {
    await db().from("workers").delete().eq("id", id).eq("company_id", who.companyId); // no orphan worker without pay; the retry can reuse the code
    throw e;
  }
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.create", entityType: "worker", entityId: id, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { payType: input.payType } }));
  return { id };
}

export async function updateWorkerMetadata(who: Who, workerId: string, input: WorkerMetadata): Promise<boolean> {
  if (!isPayrollRole(who.roles ?? [])) throw new WorkflowError("FORBIDDEN", "only the payroll side edits worker evidence");
  const metadata = WorkerMetadataSchema.parse(input);
  const w = (await db().from("workers").select("id").eq("company_id", who.companyId).eq("id", workerId).maybeSingle()).data;
  if (!w) return false;
  const metadata_enc = await sealJson(who.companyId, "workers", "metadata_enc", workerId, metadata);
  must(await db().from("workers").update({ metadata_enc, employment_start: metadata.employmentStart, employment_end: metadata.employmentEnd }).eq("company_id", who.companyId).eq("id", workerId).select("id"), "worker metadata");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.metadata", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { metadataUpdated: true } }));
  return true;
}

/**
 * A promotion, raise or correction is a new immutable compensation version (S19, S20); it applies to the next calculation,
 * never to an approved run. Returns false when the worker is not in the caller's company (handlers answer 404).
 */
export async function addCompensationVersion(who: Who, workerId: string, c: Compensation, payType?: PayType, reason: CompReason = "CORRECTION"): Promise<boolean> {
  const w = (await db().from("workers").select("id, active, pay_type").eq("id", workerId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!w) return false;
  if (!w.active) throw new TransitionError("INVALID_TRANSITION", "this worker has left; reactivate before changing pay");
  const scheduled = await db().from("effective_compensations").select("id").eq("company_id", who.companyId).eq("worker_id", workerId).limit(1);
  if (scheduled.error) throw new Error("effective compensation history unavailable");
  if (scheduled.data?.length) throw new WorkflowError("CONFLICT", "This worker uses effective compensation history; schedule a dated change instead");
  const last = (await db().from("compensations").select("version").eq("worker_id", workerId).eq("company_id", who.companyId).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  await insertCompensation(who, workerId, (last?.version ?? 0) + 1, c, reason); // unique (worker, version): a concurrent edit fails instead of overwriting
  if (payType && payType !== w.pay_type) {
    must(await db().from("workers").update({ pay_type: payType }).eq("id", workerId).eq("company_id", who.companyId).select("id"), "worker pay type");
    await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.pay_type", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { from: w.pay_type, to: payType } }));
  }
  return true;
}

const OPEN_OBLIGATIONS = ["CREATED", "AUTHORIZED", "ON_HOLD", "PAYING"];

/**
 * Leaving archives the worker (never deletes: runs, obligations and audit point at them). Existing obligations stay
 * payable (final pay). Returns null when not found, else how many obligations are still unpaid so the UI can say so.
 */
export async function archiveWorker(who: Who, workerId: string, input: { leftOn: string; reason: LeftReason }): Promise<{ openObligations: number } | null> {
  const w = (await db().from("workers").select("id, active").eq("id", workerId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!w) return null;
  if (!w.active) throw new TransitionError("INVALID_TRANSITION", "this worker has already left");
  const done = must(await db().from("workers").update({ active: false, left_on: input.leftOn, left_reason: input.reason, employment_end: input.leftOn }).eq("id", workerId).eq("company_id", who.companyId).eq("active", true).select("id"), "worker archive");
  if (done.length === 0) throw new TransitionError("STALE_STATE", "this worker has already left"); // lost a race
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.archive", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { leftOn: input.leftOn, reason: input.reason } }));
  const { count } = await db().from("obligations").select("id", { count: "exact", head: true }).eq("company_id", who.companyId).eq("worker_id", workerId).in("status", OPEN_OBLIGATIONS);
  return { openObligations: count ?? 0 };
}

export async function reactivateWorker(who: Who, workerId: string): Promise<boolean> {
  const w = (await db().from("workers").select("id, active").eq("id", workerId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!w) return false;
  if (w.active) throw new TransitionError("INVALID_TRANSITION", "this worker is already active");
  const done = must(await db().from("workers").update({ active: true, left_on: null, left_reason: null, employment_end: null }).eq("id", workerId).eq("company_id", who.companyId).eq("active", false).select("id"), "worker reactivate");
  if (done.length === 0) throw new TransitionError("STALE_STATE", "this worker is already active");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.reactivate", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
  return true;
}

export async function setWorkerWallet(companyId: string, workerId: string, w: { walletId: string; address: string; source: "CIRCLE" | "EXTERNAL" }) {
  // A wallet Kleeno itself creates is confirmed at once; anything else waits for a payment approver (confirmRecipient).
  const confirmed = w.source === "CIRCLE" ? { wallet_confirmed_address: w.address, wallet_confirmed_at: new Date().toISOString() } : {};
  must(await db().from("workers").update({ wallet_id: w.walletId, wallet_address: w.address, wallet_source: w.source, ...confirmed }).eq("id", workerId).eq("company_id", companyId).is("wallet_id", null).select("id"), "worker wallet"); // never overwrites an existing wallet
}

const workerWallet = async (companyId: string, workerId: string) => {
  const w = (await db().from("workers").select("id, wallet_address, wallet_confirmed_address, wallet_set_by").eq("id", workerId).eq("company_id", companyId).maybeSingle()).data;
  if (!w) throw new TransitionError("NOT_FOUND", "worker not found");
  return w;
};

/** Points a worker at an external address. The old confirmation is cleared: the new address cannot be paid until a payment approver confirms it. */
export async function changeRecipient(who: Who, workerId: string, address: string) {
  const w = await workerWallet(who.companyId, workerId);
  if (w.wallet_address?.toLowerCase() === address.toLowerCase()) throw new TransitionError("INVALID_TRANSITION", "that is already this worker's address");
  must(
    await db().from("workers").update({ wallet_address: address, wallet_source: "EXTERNAL", wallet_id: null, wallet_set_by: who.userId, wallet_confirmed_address: null, wallet_confirmed_by: null, wallet_confirmed_at: null }).eq("id", workerId).eq("company_id", who.companyId).select("id"),
    "worker recipient",
  );
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.recipient_changed", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
}

/** Four-eyes for the recipient: the confirmer holds the payment role (checked in the route and by a trigger) and is not the person who set the address. */
export async function confirmRecipient(who: Who, workerId: string) {
  const w = await workerWallet(who.companyId, workerId);
  if (!w.wallet_address) throw new TransitionError("INVALID_TRANSITION", "this worker has no wallet address");
  if (w.wallet_confirmed_address?.toLowerCase() === w.wallet_address.toLowerCase()) throw new TransitionError("INVALID_TRANSITION", "this address is already confirmed");
  if (w.wallet_set_by === who.userId) throw new WorkflowError("FOUR_EYES", "a different payment approver must confirm this address");
  const done = must(
    await db().from("workers").update({ wallet_confirmed_address: w.wallet_address, wallet_confirmed_by: who.userId, wallet_confirmed_at: new Date().toISOString() }).eq("id", workerId).eq("company_id", who.companyId).eq("wallet_address", w.wallet_address).select("id"),
    "worker confirm",
  );
  if (done.length === 0) throw new TransitionError("STALE_STATE", "the address changed; review it again");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.recipient_confirmed", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
}

export interface WorkerRow {
  id: string;
  pseudonym: string;
  payType: PayType;
  walletAddress: string | null;
  walletSource: string;
  /** The payout address was confirmed by a payment approver (or is a wallet Kleeno created). Unconfirmed wallets cannot be paid. */
  walletConfirmed: boolean;
  active: boolean;
  compensation: Compensation | null;
  compensationVersion: number | null;
  leftOn: string | null;
  leftReason: string | null;
  history: { version: number; reason: string; baseAmount: bigint; hourlyRate: bigint; at: string }[]; // newest first
  metadata: WorkerMetadata;
}

/** Reads through `reader` (the user-scoped client, so RLS applies) and decrypts on the server. */
export async function listWorkers(reader: SupabaseClient, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<WorkerRow[]> {
  const workerResult = await reader.from("workers").select("id, pseudonym, pay_type, wallet_address, wallet_source, wallet_confirmed_address, active, left_on, left_reason, metadata_enc, employment_start, employment_end", { count: "exact" }).eq("company_id", companyId).order("pseudonym");
  const allWorkers = must(workerResult, "workers read");
  if (workerResult.count !== allWorkers.length) throw new Error("worker evidence is incomplete");
  const workers = allWorkers.filter((w) => w.active || !opts.activeOnly); // runs use activeOnly: leavers are not paid new periods
  const compResult = await reader.from("compensations").select("id, worker_id, version, reason, created_at, payload_enc", { count: "exact" }).eq("company_id", companyId).order("version", { ascending: false });
  const comps = must(compResult, "compensations read");
  if (compResult.count !== comps.length) throw new Error("compensation evidence is incomplete");
  return Promise.all(
    workers.map(async (w) => {
      const history = await Promise.all(
        comps.filter((x) => x.worker_id === w.id).map(async (c) => {
          const p = await openJson<{ baseAmount: string; hourlyRate: string }>(companyId, "compensations", "payload_enc", c.id, c.payload_enc);
          return { version: c.version, reason: c.reason, baseAmount: BigInt(p.baseAmount), hourlyRate: BigInt(p.hourlyRate), at: c.created_at };
        }),
      );
      const cur = history[0];
      const metadata = WorkerMetadataSchema.parse(w.metadata_enc ? await openJson<WorkerMetadata>(companyId, "workers", "metadata_enc", w.id, w.metadata_enc) : {});
      return {
        id: w.id,
        pseudonym: w.pseudonym,
        payType: w.pay_type,
        walletAddress: w.wallet_address,
        walletSource: w.wallet_source,
        walletConfirmed: !!w.wallet_address && w.wallet_address.toLowerCase() === w.wallet_confirmed_address?.toLowerCase(),
        active: w.active,
        compensation: cur ? { baseAmount: cur.baseAmount, hourlyRate: cur.hourlyRate } : null,
        compensationVersion: cur?.version ?? null,
        leftOn: w.left_on,
        leftReason: w.left_reason,
        history,
        metadata: { ...metadata, employmentStart: w.employment_start, employmentEnd: w.employment_end },
      };
    }),
  );
}
