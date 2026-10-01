// Audit events (rule 34, S32, S45). References only: IDs, states, hashes. Never payroll values.
export type ActorType = "user" | "ai" | "system" | "agent" | "script";

export interface AuditEvent {
  companyId: string;
  event: string; // e.g. "run.approve", "LOGIN_FAILED"
  entityType: string;
  entityId: string | null;
  actor: string; // user id, or a fixed name for non-users
  actorType: ActorType;
  correlationId: string;
  refs: Record<string, string | number | boolean | null>;
}

/** One per request; carried to AI executions, audit events, attempts, Circle refId and settlement (S33). */
export const newCorrelationId = () => crypto.randomUUID();

export function auditEvent(e: Omit<AuditEvent, "refs"> & { refs?: AuditEvent["refs"] }): AuditEvent {
  return { ...e, refs: e.refs ?? {} };
}
