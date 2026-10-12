import { expect, it } from "vitest";
import { analyse, type ReconInput } from "@/core/reconciliation";
import { CONFIG } from "../fixtures/payroll/cases";

const input: ReconInput = { config: { ...CONFIG, hourlyCapHours: "8" }, period: { start: "2026-01-01", end: "2026-01-31" }, workers: [{ id: "w1", payType: "HOURLY" }], timesheets: [{ id: "t1", workerId: "w1", date: "2026-01-10", hours: "6", approvedExtraHours: "0", seq: 1 }, { id: "t2", workerId: "w1", date: "2026-01-20", hours: "6", approvedExtraHours: "2", seq: 2 }], leave: [] };
it("projects only human-reconciled retained dates and actual approved excess without changing legacy inputs", () => {
  const resolutions = new Map([["uo|w1|period", "EXCLUDE_HOURS" as const]]);
  expect(analyse(input, resolutions).inputs!.get("w1")).not.toHaveProperty("datedHours");
  const result = analyse(input, resolutions, new Set(["w1"])).inputs!.get("w1")!;
  expect(result.datedHours).toEqual([{ date: "2026-01-10", workedHours: "6", approvedAboveCapHours: "0" }, { date: "2026-01-20", workedHours: "6", approvedAboveCapHours: "2" }]);
});
it("does not assign pooled hourly approvals to inferred excess dates", () => {
  const evidence = { ...input, timesheets: input.timesheets.map(row => ({ ...row, approvedExtraHours: "0" })) };
  const result = analyse(evidence, new Map([["uo|w1|period", "APPROVE_HOURS" as const]]), new Set(["w1"])).inputs!.get("w1")!;
  expect(result.approvedAboveCapHours).toBe("4"); expect(result.datedHours!.every(row => row.approvedAboveCapHours === "0")).toBe(true);
});
it("stage-one duplicate human decision controls dated hours, not raw duplicate records", () => {
  const evidence = { ...input, config: { ...input.config, hourlyCapHours: null }, timesheets: [...input.timesheets, { ...input.timesheets[0], id: "duplicate", hours: "2", seq: 3 }] };
  expect(analyse(evidence, new Map([["dup|w1|2026-01-10", "KEEP_LATEST" as const]]), new Set(["w1"])).inputs!.get("w1")!.datedHours?.[0].workedHours).toBe("2");
});
