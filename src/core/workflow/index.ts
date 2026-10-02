import { auditEvent, type AuditEvent } from "../audit";
import { nextState, runMachine, SIMULATION_STATES, TransitionError, type RunState } from "../domain/machines";
import { applyTransition, type StateStore, type TransitionRequest } from "../domain/transition";
import type { RunMode } from "../ports";

// Roles come only from app_users (rule 33). The payroll side and the payment side are different people (rule 18).
export type Role = "PAYROLL_APPROVER" | "HR_APPROVER" | "PAYMENT_APPROVER" | "VIEWER";
export const isPayrollRole = (r: Role) => r === "PAYROLL_APPROVER" || r === "HR_APPROVER";
export const isPaymentRole = (r: Role) => r === "PAYMENT_APPROVER";

export class WorkflowError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "FLAGS_UNCONFIRMED" | "CALCULATION_BLOCKED" | "LIVE_PAYMENTS_DISABLED" | "NO_ACTIVE_CONFIG" | "FOUR_EYES" | "RUN_FROZEN" | "SIMULATION_CANNOT_PAY",
    message: string,
  ) {
    super(message);
  }
}

/** Four-eyes (rule 18): the payment authorizer must differ from the payroll approver. The DB trigger enforces it too. */
export function assertFourEyes(payrollApproverId: string, authorizerId: string) {
  if (payrollApproverId === authorizerId) throw new WorkflowError("FOUR_EYES", "the payment authorizer must differ from the payroll approver");
}

/** After READY_FOR_CALCULATION nothing new may be imported into a run (S20, ARCHITECTURE 11). */
const IMPORT_OPEN: readonly RunState[] = ["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING"];
export function assertRunAcceptsImports(status: RunState) {
  if (!IMPORT_OPEN.includes(status)) throw new WorkflowError("RUN_FROZEN", `run inputs are frozen in ${status}; start a new run`);
}

export interface RunDeps {
  liveEnabled(companyId: string): Promise<boolean>;
  activeConfigVersion(companyId: string): Promise<number | null>;
  insertRun(r: { companyId: string; mode: RunMode; periodStart: string; periodEnd: string; configVersion: number; createdBy: string }): Promise<{ id: string }>;
  audit(e: AuditEvent): Promise<void>;
}

export interface Ctx {
  companyId: string;
  userId: string;
  role: Role;
  correlationId: string;
}

/** Creates a DRAFT run pinned to the company's ACTIVE config. LIVE_TESTNET is refused while the kill switch is off (rule 17). */
export async function createRun(deps: RunDeps, ctx: Ctx, input: { mode: RunMode; periodStart: string; periodEnd: string }): Promise<{ id: string }> {
  if (!isPayrollRole(ctx.role)) throw new WorkflowError("FORBIDDEN", "only the payroll side can create runs");
  if (input.mode === "LIVE_TESTNET" && !(await deps.liveEnabled(ctx.companyId))) throw new WorkflowError("LIVE_PAYMENTS_DISABLED", "live payments are off for this company");
  const configVersion = await deps.activeConfigVersion(ctx.companyId);
  if (configVersion === null) throw new WorkflowError("NO_ACTIVE_CONFIG", "approve and activate a configuration first");
  const { id } = await deps.insertRun({ companyId: ctx.companyId, mode: input.mode, periodStart: input.periodStart, periodEnd: input.periodEnd, configVersion, createdBy: ctx.userId });
  await deps.audit(auditEvent({ companyId: ctx.companyId, event: "run.create", entityType: "run", entityId: id, actor: ctx.userId, actorType: "user", correlationId: ctx.correlationId, refs: { mode: input.mode, configVersion } }));
  return { id };
}

/** Run transition. A SIMULATION run can never move past CALCULATION_VALIDATED: rejected here and by a DB CHECK (S38). */
export async function runAction(store: StateStore<RunState>, mode: RunMode, current: RunState, req: TransitionRequest): Promise<RunState> {
  const target = nextState(runMachine, current, req.action);
  if (mode === "SIMULATION" && target !== null && !SIMULATION_STATES.includes(target)) {
    throw new WorkflowError("SIMULATION_CANNOT_PAY", "a SIMULATION run stops at CALCULATION_VALIDATED");
  }
  return applyTransition(store, runMachine, req);
}

export { TransitionError };
