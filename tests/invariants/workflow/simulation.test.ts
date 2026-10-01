// PROTECTED. S38 (state-machine part): a SIMULATION run can never reach approval or payment. Also run creation rules.
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/core/audit";
import { RUN_STATES, SIMULATION_STATES, runMachine, type RunState } from "@/core/domain/machines";
import type { StateStore } from "@/core/domain/transition";
import { assertFourEyes, assertRunAcceptsImports, createRun, runAction, WorkflowError, type Ctx, type RunDeps } from "@/core/workflow";

class MemStore implements StateStore<RunState> {
  audits: AuditEvent[] = [];
  constructor(public state: RunState) {}
  async load() {
    return this.state;
  }
  async cas(_id: string, _c: string, from: RunState, to: RunState, a: AuditEvent) {
    if (this.state !== from) return false;
    this.state = to;
    this.audits.push(a);
    return true;
  }
}
const req = (action: string) => ({ id: "r1", companyId: "co", action, actor: "u", actorType: "user" as const, correlationId: "c" });

describe("S38 SIMULATION never pays (state machine)", () => {
  it("every action that would leave the SIMULATION states is refused for a SIMULATION run, from every state", async () => {
    for (const from of RUN_STATES) {
      for (const [action, to] of Object.entries(runMachine.transitions[from])) {
        const s = new MemStore(from);
        const attempt = runAction(s, "SIMULATION", from, req(action));
        if (SIMULATION_STATES.includes(to as RunState)) await expect(attempt).resolves.toBe(to);
        else {
          await expect(attempt).rejects.toMatchObject({ code: "SIMULATION_CANNOT_PAY" });
          expect(s.state).toBe(from); // nothing moved, nothing audited
          expect(s.audits).toHaveLength(0);
        }
      }
    }
  });

  it("the same actions work for a LIVE_TESTNET run", async () => {
    const s = new MemStore("PENDING_APPROVAL");
    await expect(runAction(s, "LIVE_TESTNET", "PENDING_APPROVAL", req("approve"))).resolves.toBe("APPROVED");
  });
});

describe("run creation and workflow guards", () => {
  const deps = (over: Partial<RunDeps> = {}): RunDeps & { audits: AuditEvent[] } => {
    const audits: AuditEvent[] = [];
    return {
      audits,
      liveEnabled: async () => true,
      activeConfigVersion: async () => 3,
      insertRun: async () => ({ id: "run-1" }),
      audit: async (e) => void audits.push(e),
      ...over,
    };
  };
  const ctx: Ctx = { companyId: "co", userId: "u1", role: "PAYROLL_APPROVER", correlationId: "c" };
  const input = { mode: "LIVE_TESTNET" as const, periodStart: "2026-10-01", periodEnd: "2026-10-31" };

  it("creates a run pinned to the active config and audits it once", async () => {
    const d = deps();
    await expect(createRun(d, ctx, input)).resolves.toEqual({ id: "run-1" });
    expect(d.audits).toHaveLength(1);
    expect(d.audits[0]).toMatchObject({ event: "run.create", refs: { mode: "LIVE_TESTNET", configVersion: 3 } });
  });

  it("refuses LIVE_TESTNET while live payments are off (kill switch), but SIMULATION is fine", async () => {
    const d = deps({ liveEnabled: async () => false });
    await expect(createRun(d, ctx, input)).rejects.toMatchObject({ code: "LIVE_PAYMENTS_DISABLED" });
    await expect(createRun(d, ctx, { ...input, mode: "SIMULATION" })).resolves.toBeTruthy();
  });

  it("refuses without an active config and for roles outside the payroll side", async () => {
    await expect(createRun(deps({ activeConfigVersion: async () => null }), ctx, input)).rejects.toMatchObject({ code: "NO_ACTIVE_CONFIG" });
    await expect(createRun(deps(), { ...ctx, role: "PAYMENT_APPROVER" }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createRun(deps(), { ...ctx, role: "VIEWER" }, input)).rejects.toBeInstanceOf(WorkflowError);
  });

  it("four-eyes: the same user cannot be both", () => {
    expect(() => assertFourEyes("u1", "u1")).toThrow(WorkflowError);
    expect(() => assertFourEyes("u1", "u2")).not.toThrow();
  });

  it("S20: imports are refused once a run is past reconciliation", () => {
    for (const ok of ["DRAFT", "DATA_IMPORTED", "RECONCILING", "EXCEPTIONS_PENDING"] as const) expect(() => assertRunAcceptsImports(ok)).not.toThrow();
    for (const frozen of ["READY_FOR_CALCULATION", "CALCULATED", "PENDING_APPROVAL", "APPROVED", "SETTLED"] as const) {
      expect(() => assertRunAcceptsImports(frozen)).toThrow(WorkflowError);
    }
  });
});
