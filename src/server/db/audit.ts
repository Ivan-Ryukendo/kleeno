import "server-only";
import type { AuditEvent } from "@/core/audit";
import { db, must } from "./client";

/** Non-transition events (login, create, config edits). State changes are audited inside cas_transition. References only (S45). */
export async function writeAudit(e: AuditEvent) {
  must(
    await db()
      .from("audit_events")
      .insert({ company_id: e.companyId, event: e.event, entity_type: e.entityType, entity_id: e.entityId, actor: e.actor, actor_type: e.actorType, correlation_id: e.correlationId, refs: e.refs })
      .select("id"),
    "audit insert",
  );
}
