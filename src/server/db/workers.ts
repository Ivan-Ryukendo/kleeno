import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditEvent } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import type { PayType } from "@/core/engine";
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
}

async function insertCompensation(who: Who, workerId: string, version: number, c: Compensation, reason: CompReason) {
  const id = randomUUID();
  const payload = await sealJson(who.companyId, "compensations", "payload_enc", id, { baseAmount: c.baseAmount, hourlyRate: c.hourlyRate });
  must(await db().from("compensations").insert({ id, company_id: who.companyId, worker_id: workerId, version, payload_enc: payload, created_by: who.userId, reason }).select("id"), "compensation insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "compensation.version", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { version, reason } }));
}

export async function createWorker(who: Who, input: { pseudonym: string; payType: PayType; compensation: Compensation }) {
  const id = randomUUID();
  must(await db().from("workers").insert({ id, company_id: who.companyId, pseudonym: input.pseudonym, pay_type: input.payType }).select("id"), "worker insert"); // unique (company, pseudonym)
  try {
    await insertCompensation(who, id, 1, input.compensation, "INITIAL");
  } catch (e) {
    await db().from("workers").delete().eq("id", id).eq("company_id", who.companyId); // no orphan worker without pay; the retry can reuse the code
    throw e;
  }
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.create", entityType: "worker", entityId: id, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { payType: input.payType } }));
  return { id };
}

/**
 * A promotion, raise or correction is a new immutable compensation version (S19, S20); it applies to the next calculation,
 * never to an approved run. Returns false when the worker is not in the caller's company (handlers answer 404).
 */
export async function addCompensationVersion(who: Who, workerId: string, c: Compensation, payType?: PayType, reason: CompReason = "CORRECTION"): Promise<boolean> {
  const w = (await db().from("workers").select("id, active, pay_type").eq("id", workerId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!w) return false;
  if (!w.active) throw new TransitionError("INVALID_TRANSITION", "this worker has left; reactivate before changing pay");
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
  const done = must(await db().from("workers").update({ active: false, left_on: input.leftOn, left_reason: input.reason }).eq("id", workerId).eq("company_id", who.companyId).eq("active", true).select("id"), "worker archive");
  if (done.length === 0) throw new TransitionError("STALE_STATE", "this worker has already left"); // lost a race
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.archive", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { leftOn: input.leftOn, reason: input.reason } }));
  const { count } = await db().from("obligations").select("id", { count: "exact", head: true }).eq("company_id", who.companyId).eq("worker_id", workerId).in("status", OPEN_OBLIGATIONS);
  return { openObligations: count ?? 0 };
}

export async function reactivateWorker(who: Who, workerId: string): Promise<boolean> {
  const w = (await db().from("workers").select("id, active").eq("id", workerId).eq("company_id", who.companyId).maybeSingle()).data;
  if (!w) return false;
  if (w.active) throw new TransitionError("INVALID_TRANSITION", "this worker is already active");
  const done = must(await db().from("workers").update({ active: true, left_on: null, left_reason: null }).eq("id", workerId).eq("company_id", who.companyId).eq("active", false).select("id"), "worker reactivate");
  if (done.length === 0) throw new TransitionError("STALE_STATE", "this worker is already active");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "worker.reactivate", entityType: "worker", entityId: workerId, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
  return true;
}

export async function setWorkerWallet(companyId: string, workerId: string, w: { walletId: string; address: string; source: "CIRCLE" | "EXTERNAL" }) {
  must(await db().from("workers").update({ wallet_id: w.walletId, wallet_address: w.address, wallet_source: w.source }).eq("id", workerId).eq("company_id", companyId).is("wallet_id", null).select("id"), "worker wallet"); // never overwrites an existing wallet
}

export interface WorkerRow {
  id: string;
  pseudonym: string;
  payType: PayType;
  walletAddress: string | null;
  walletSource: string;
  active: boolean;
  compensation: Compensation | null;
  compensationVersion: number | null;
  leftOn: string | null;
  leftReason: string | null;
  history: { version: number; reason: string; baseAmount: bigint; hourlyRate: bigint; at: string }[]; // newest first
}

/** Reads through `reader` (the user-scoped client, so RLS applies) and decrypts on the server. */
export async function listWorkers(reader: SupabaseClient, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<WorkerRow[]> {
  const workers = must(await reader.from("workers").select("id, pseudonym, pay_type, wallet_address, wallet_source, active, left_on, left_reason").eq("company_id", companyId).order("pseudonym"), "workers read").filter((w) => w.active || !opts.activeOnly); // runs use activeOnly: leavers are not paid new periods
  const comps = must(await reader.from("compensations").select("id, worker_id, version, reason, created_at, payload_enc").eq("company_id", companyId).order("version", { ascending: false }), "compensations read");
  return Promise.all(
    workers.map(async (w) => {
      const history = await Promise.all(
        comps.filter((x) => x.worker_id === w.id).map(async (c) => {
          const p = await openJson<{ baseAmount: string; hourlyRate: string }>(companyId, "compensations", "payload_enc", c.id, c.payload_enc);
          return { version: c.version, reason: c.reason, baseAmount: BigInt(p.baseAmount), hourlyRate: BigInt(p.hourlyRate), at: c.created_at };
        }),
      );
      const cur = history[0];
      return {
        id: w.id,
        pseudonym: w.pseudonym,
        payType: w.pay_type,
        walletAddress: w.wallet_address,
        walletSource: w.wallet_source,
        active: w.active,
        compensation: cur ? { baseAmount: cur.baseAmount, hourlyRate: cur.hourlyRate } : null,
        compensationVersion: cur?.version ?? null,
        leftOn: w.left_on,
        leftReason: w.left_reason,
        history,
      };
    }),
  );
}
