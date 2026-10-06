import { expect, it } from "vitest";
import { seedSimulationDemo } from "../../scripts/seed-demo";
import { admin, makeCompany } from "./helpers";

const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.SUPABASE_URL!).hostname);
it.skipIf(!local)("repeated synthetic seeding preserves the run, evidence and human-review exceptions", async () => {
  const c = await makeCompany();
  await expect(seedSimulationDemo(c.id, c.payroll.id)).rejects.toThrow("designated");
  expect((await admin.from("companies").update({ is_demo: true }).eq("id", c.id)).error).toBeNull();
  const first = await seedSimulationDemo(c.id, c.payroll.id);
  const before = (await admin.from("import_batches").select("id").eq("run_id", first.runId)).data;
  expect(await seedSimulationDemo(c.id, c.payroll.id)).toEqual(first);
  expect((await admin.from("import_batches").select("id").eq("run_id", first.runId)).data).toEqual(before);
  expect((await admin.from("workers").select("id").eq("company_id", c.id)).data).toHaveLength(6);
  expect((await admin.from("payroll_runs").select("mode,status").eq("id", first.runId).single()).data).toEqual({ mode: "SIMULATION", status: "EXCEPTIONS_PENDING" });
  expect((await admin.from("obligations").select("id").eq("run_id", first.runId)).data).toEqual([]);
  const worker = (await admin.from("workers").select("id").eq("company_id", c.id).limit(1).single()).data!;
  expect((await admin.from("workers").update({ employment_start: "2026-10-05" }).eq("id", worker.id)).error).toBeNull();
  await expect(seedSimulationDemo(c.id, c.payroll.id)).rejects.toThrow("workforce differs");
});
