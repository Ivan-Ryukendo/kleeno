// S18 in the database: the DB transition table equals the core machines; compare-and-set is atomic and audited;
// rows are born in their first state; invalid direct updates are rejected.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DB_MACHINES, runMachine, type Machine, type RunState } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { runStore } from "@/server/db/runs";
import { activeConfig, admin, makeCompany } from "./helpers";

async function draftRun(companyId: string, userId: string, version: number) {
  const r = await admin.from("payroll_runs").insert({ company_id: companyId, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-31", config_version: version, created_by: userId }).select("id").single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id as string;
}
const req = (companyId: string, id: string, action: string) => ({ id, companyId, action, actor: "test", actorType: "script" as const, correlationId: randomUUID() });

describe("transition table parity (core == database)", () => {
  for (const [table, machine] of Object.entries(DB_MACHINES)) {
    it(`${table}: every (from,to) pair agrees`, async () => {
      const m = machine as Machine;
      const states = Object.keys(m.transitions);
      const bad: string[] = [];
      for (const from of states) {
        const allowed = new Set(Object.values(m.transitions[from] as Record<string, string>));
        for (const to of states) {
          const r = await admin.rpc("transition_allowed", { p_machine: table, p_from: from, p_to: to });
          if (r.data !== allowed.has(to)) bad.push(`${from}->${to}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("compare-and-set", () => {
  it("writes exactly one audit event with the correlation id, in the same commit", async () => {
    const c = await makeCompany();
    const cfg = await activeConfig(c);
    const id = await draftRun(c.id, c.payroll.id, cfg.version);
    const cid = randomUUID();
    await applyTransition(runStore, runMachine, { ...req(c.id, id, "import_data"), correlationId: cid });
    const ev = await admin.from("audit_events").select("event, actor, actor_type, correlation_id, refs").eq("entity_id", id).eq("event", "run.import_data");
    expect(ev.data).toHaveLength(1);
    expect(ev.data![0]).toMatchObject({ actor: "test", actor_type: "script", correlation_id: cid, refs: { from: "DRAFT", to: "DATA_IMPORTED" } });
  });

  it("two concurrent transitions: exactly one wins, one audit event", async () => {
    const c = await makeCompany();
    const cfg = await activeConfig(c);
    const id = await draftRun(c.id, c.payroll.id, cfg.version);
    await applyTransition(runStore, runMachine, req(c.id, id, "import_data"));
    const results = await Promise.allSettled([applyTransition(runStore, runMachine, req(c.id, id, "start_reconciliation")), applyTransition(runStore, runMachine, req(c.id, id, "start_reconciliation"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["STALE_STATE", "INVALID_TRANSITION"]).toContain(lost.reason.code);
    const ev = await admin.from("audit_events").select("id").eq("entity_id", id).eq("event", "run.start_reconciliation");
    expect(ev.data).toHaveLength(1);
  });

  it("a stale cas (wrong from-state) changes nothing and audits nothing", async () => {
    const c = await makeCompany();
    const cfg = await activeConfig(c);
    const id = await draftRun(c.id, c.payroll.id, cfg.version);
    const ok = await runStore.cas(id, c.id, "CALCULATED" as RunState, "CALCULATION_VALIDATED" as RunState, { companyId: c.id, event: "run.validate_calculation", entityType: "run", entityId: id, actor: "t", actorType: "script", correlationId: "x", refs: {} });
    expect(ok).toBe(false);
    expect((await admin.from("payroll_runs").select("status").eq("id", id).single()).data!.status).toBe("DRAFT");
    expect((await admin.from("audit_events").select("id").eq("entity_id", id).eq("event", "run.validate_calculation")).data).toHaveLength(0);
  });

  it("another company cannot move the row", async () => {
    const c = await makeCompany();
    const other = await makeCompany();
    const cfg = await activeConfig(c);
    const id = await draftRun(c.id, c.payroll.id, cfg.version);
    await expect(applyTransition(runStore, runMachine, req(other.id, id, "import_data"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("database guards on status", () => {
  it("rejects an illegal direct status update, even from the service role", async () => {
    const c = await makeCompany();
    const cfg = await activeConfig(c);
    const id = await draftRun(c.id, c.payroll.id, cfg.version);
    const r = await admin.from("payroll_runs").update({ status: "APPROVED" }).eq("id", id).select("id");
    expect(r.error).not.toBeNull();
  });

  it("rows are born in their first state", async () => {
    const c = await makeCompany();
    const cfg = await activeConfig(c);
    const r = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "SIMULATION", status: "CALCULATED", period_start: "2026-10-01", period_end: "2026-10-31", config_version: cfg.version });
    expect(r.error).not.toBeNull();
    const e = await admin.from("payroll_configurations").insert({ company_id: c.id, version: 99, status: "ACTIVE", params: cfg.config, clauses_enc: "x" });
    expect(e.error).not.toBeNull();
  });
});
