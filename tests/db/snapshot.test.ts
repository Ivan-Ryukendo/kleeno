// S20: after approval nothing changes the approved calculation, hash or obligation amounts; past READY_FOR_CALCULATION no import.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { TransitionError, runMachine, type RunState } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { parseUsdc } from "@/core/money";
import { runStore } from "@/server/db/runs";
import { addCompensationVersion } from "@/server/db/workers";
import { activeConfig, admin, approvedRun, makeCompany, type BuiltRun, type TestCompany } from "./helpers";

let c: TestCompany;
let r: BuiltRun;

const snapshotOf = async () => {
  const calc = (await admin.from("calculations").select("calculation_hash, snapshot_enc").eq("id", r.calculationId).single()).data!;
  const line = (await admin.from("calculation_lines").select("net, gross_enc").eq("id", r.lineId).single()).data!;
  const ob = (await admin.from("obligations").select("amount, calculation_hash").eq("id", r.obligationId).single()).data!;
  return JSON.stringify({ calc, line, ob });
};

beforeAll(async () => {
  c = await makeCompany({ live: true });
  r = await approvedRun(c, await activeConfig(c));
});

describe("S20 snapshot immutability", () => {
  it("a new compensation version or a new config leaves the approved calculation and obligation untouched", async () => {
    const before = await snapshotOf();
    const who = { companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() };
    expect(await addCompensationVersion(who, r.workerId, { baseAmount: parseUsdc("999"), hourlyRate: 0n })).toBe(true);
    await activeConfig(c); // a newer config version becomes active
    expect(await snapshotOf()).toBe(before);
  });

  it("the stored hash still matches the obligation", async () => {
    const ob = (await admin.from("obligations").select("calculation_hash").eq("id", r.obligationId).single()).data!;
    expect(ob.calculation_hash).toBe(r.hash);
  });

  it("importing into a run past READY_FOR_CALCULATION is rejected", async () => {
    await expect(applyTransition<RunState>(runStore, runMachine, { id: r.runId, companyId: c.id, action: "import_data", actor: "test", actorType: "script", correlationId: randomUUID() })).rejects.toBeInstanceOf(TransitionError);
    const run = (await admin.from("payroll_runs").select("status").eq("id", r.runId).single()).data!;
    expect(run.status).toBe("APPROVED");
  });

  it("the calculation row cannot be rewritten even by the service role", async () => {
    const res = await admin.from("calculations").update({ calculation_hash: "0x00" }).eq("id", r.calculationId).select("id");
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    const after = (await admin.from("calculations").select("calculation_hash").eq("id", r.calculationId).single()).data!;
    expect(after.calculation_hash).toBe(r.hash);
  });
});

describe("atomic save", () => {
  it("a calculation with a bad line leaves no calculation behind (all or nothing)", async () => {
    const run = await admin.from("payroll_runs").select("id").eq("company_id", c.id).limit(2);
    expect(run.data?.length).toBeGreaterThan(0);
    const before = (await admin.from("calculations").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count;
    const calcId = randomUUID();
    const bad = await admin.rpc("save_calculation", {
      p_calc: { id: calcId, company_id: c.id, run_id: run.data![0].id, config_version: 1, calculation_hash: "0x", snapshot_enc: "x" },
      p_lines: [{ id: randomUUID(), company_id: c.id, calculation_id: calcId, worker_id: randomUUID(), net: "1", gross_enc: "x", deductions_enc: "x", trace_enc: "x" }], // unknown worker
    });
    expect(bad.error).not.toBeNull();
    expect((await admin.from("calculations").select("id", { count: "exact", head: true }).eq("company_id", c.id)).count).toBe(before);
  });
});
