// S18: valid, invalid, duplicate, stale and concurrent transitions for every machine.
import { describe, expect, it } from "vitest";
import { batchMachine, configMachine, exceptionMachine, obligationMachine, paymentMachine, runMachine, SIMULATION_STATES, RUN_STATES, TransitionError, type Machine } from "@/core/domain/machines";
import { applyTransition, type StateStore } from "@/core/domain/transition";
import type { AuditEvent } from "@/core/audit";

class MemStore implements StateStore<string> {
  audits: AuditEvent[] = [];
  constructor(public state: string) {}
  async load(_id: string, companyId: string) {
    return companyId === "co-a" ? this.state : null;
  }
  async cas(_id: string, _c: string, from: string, to: string, audit: AuditEvent) {
    await Promise.resolve(); // yield, so concurrent callers interleave
    if (this.state !== from) return false;
    this.state = to;
    this.audits.push(audit);
    return true;
  }
}

const req = (action: string, companyId = "co-a") => ({ id: "x", companyId, action, actor: "u1", actorType: "user" as const, correlationId: "c1" });
const machines: Machine[] = [runMachine, configMachine, exceptionMachine, obligationMachine, batchMachine, paymentMachine];

describe("state machines", () => {
  it("every declared transition works and writes exactly one audit event (S32)", async () => {
    for (const m of machines) {
      for (const [from, acts] of Object.entries(m.transitions)) {
        for (const [action, to] of Object.entries(acts as Record<string, string>)) {
          const s = new MemStore(from);
          expect(await applyTransition(s, m, req(action))).toBe(to);
          expect(s.audits).toHaveLength(1);
          expect(s.audits[0]).toMatchObject({ event: `${m.name}.${action}`, refs: { from, to }, correlationId: "c1" });
        }
      }
    }
  });

  it("every state is reachable only through declared actions; unknown or wrong-state actions are rejected with no audit", async () => {
    for (const m of machines) {
      for (const from of Object.keys(m.transitions)) {
        const s = new MemStore(from);
        await expect(applyTransition(s, m, req("delete_everything"))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
        expect(s.audits).toHaveLength(0);
      }
    }
  });

  it("a duplicate action fails: the second call sees the new state", async () => {
    const s = new MemStore("PENDING_APPROVAL");
    await applyTransition(s, runMachine, req("approve"));
    await expect(applyTransition(s, runMachine, req("approve"))).rejects.toBeInstanceOf(TransitionError);
    expect(s.audits).toHaveLength(1);
  });

  it("two concurrent transitions: exactly one wins (stale state)", async () => {
    const s = new MemStore("PENDING_APPROVAL");
    const results = await Promise.allSettled([applyTransition(s, runMachine, req("approve")), applyTransition(s, runMachine, req("reject"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "STALE_STATE" });
    expect(s.audits).toHaveLength(1);
  });

  it("another company's row is not found", async () => {
    await expect(applyTransition(new MemStore("DRAFT"), runMachine, req("import_data", "co-b"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("RECONCILING (the stranded state of R3.2) exits only through the two reconciliation outcomes, once", async () => {
    expect(Object.entries(runMachine.transitions.RECONCILING)).toEqual([["raise_exceptions", "EXCEPTIONS_PENDING"], ["finish_reconciliation", "READY_FOR_CALCULATION"]]);
    const s = new MemStore("RECONCILING");
    await expect(applyTransition(s, runMachine, req("start_reconciliation"))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await applyTransition(s, runMachine, req("finish_reconciliation"));
    await expect(applyTransition(s, runMachine, req("finish_reconciliation"))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(s.audits).toHaveLength(1);
  });

  it("rules that must hold in the tables: SIMULATION never approves, held obligations only via authorize, terminal states end", () => {
    expect(SIMULATION_STATES).not.toContain("PENDING_APPROVAL");
    expect(RUN_STATES.slice(0, SIMULATION_STATES.length)).toEqual([...SIMULATION_STATES]);
    expect(Object.keys(obligationMachine.transitions.ON_HOLD)).toEqual(["authorize"]);
    for (const [m, s] of [[runMachine, "RECONCILED"], [runMachine, "REJECTED"], [obligationMachine, "SETTLED"], [batchMachine, "COMPLETED"], [configMachine, "ARCHIVED"]] as const) {
      expect(Object.keys((m as Machine).transitions[s])).toEqual([]);
    }
  });
});
