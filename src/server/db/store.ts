import "server-only";
import type { AuditEvent } from "@/core/audit";
import type { StateStore } from "@/core/domain/transition";
import { db } from "./client";

/** Compare-and-set store over a status column: the database function updates the row and writes the audit event atomically. */
export function dbStore<S extends string>(table: "payroll_runs" | "payroll_configurations" | "exceptions" | "obligations" | "payment_batches"): StateStore<S> {
  return {
    async load(id, companyId) {
      const row = (await db().from(table).select("status").eq("id", id).eq("company_id", companyId).maybeSingle()).data as { status: S } | null;
      return row?.status ?? null;
    },
    async cas(id, companyId, from, to, a: AuditEvent) {
      const res = await db().rpc("cas_transition", {
        p_table: table,
        p_company: companyId,
        p_id: id,
        p_from: from,
        p_to: to,
        p_entity_type: a.entityType,
        p_event: a.event,
        p_actor: a.actor,
        p_actor_type: a.actorType,
        p_correlation: a.correlationId,
        p_refs: a.refs,
      });
      if (res.error) throw new Error(`db cas failed${res.error.code ? ` (${res.error.code})` : ""}`);
      return res.data === true;
    },
  };
}
