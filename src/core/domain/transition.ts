import { auditEvent, type ActorType } from "../audit";
import { nextState, TransitionError, type Machine } from "./machines";

export interface StateStore<S extends string> {
  /** Scoped by company: another company's row is "not found". */
  load(id: string, companyId: string): Promise<S | null>;
  /**
   * Atomic compare-and-set: change the state only if it is still `from`, and write the audit event in the
   * same commit. Returns false when someone else moved it first.
   */
  cas(id: string, companyId: string, from: S, to: S, audit: ReturnType<typeof auditEvent>): Promise<boolean>;
}

export interface TransitionRequest {
  id: string;
  companyId: string;
  action: string;
  actor: string;
  actorType: ActorType;
  correlationId: string;
  refs?: Record<string, string | number | boolean | null>;
}

/** The only way a state changes (rule 13). Exactly one audit event per successful transition (S32). */
export async function applyTransition<S extends string>(store: StateStore<S>, m: Machine<S>, req: TransitionRequest): Promise<S> {
  const from = await store.load(req.id, req.companyId);
  if (from === null) throw new TransitionError("NOT_FOUND", `${m.name} not found`);
  const to = nextState(m, from, req.action);
  if (to === null) throw new TransitionError("INVALID_TRANSITION", `${m.name}: '${req.action}' is not allowed from ${from}`);
  const audit = auditEvent({
    companyId: req.companyId,
    event: `${m.name}.${req.action}`,
    entityType: m.name,
    entityId: req.id,
    actor: req.actor,
    actorType: req.actorType,
    correlationId: req.correlationId,
    refs: { ...req.refs, from, to },
  });
  if (!(await store.cas(req.id, req.companyId, from, to, audit))) throw new TransitionError("STALE_STATE", `${m.name} changed concurrently`);
  return to;
}
