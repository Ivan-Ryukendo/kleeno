// Authored disposable-loopback acceptance only; never run against the remote development .env.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { loadEffectiveCompensation, scheduleCompensation } from "@/server/db/effective-compensation";
import { addCompensationVersion, createWorker } from "@/server/db/workers";
import { saveCalculation } from "@/server/db/calculations";
import { openJson } from "@/server/crypto";
import { admin, makeCompany, pendingRun, userClient } from "./helpers";

async function fixture() {
  const company = await makeCompany({ live: true }), run = await pendingRun(company);
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const initial = await loadEffectiveCompensation(admin, who, run.workerId, { effectiveFrom: "2026-10-16" });
  const command = { effectiveFrom: "2026-10-16", payType: "SALARIED" as const, baseAmount: parseUsdc("6200").toString(), hourlyRate: "0", expectedRevision: 0, baselineCompensationId: initial.baseline.id, baselineCompensationVersion: initial.baseline.version, supersedesId: null, impactedRunIds: initial.impacts.map(value => value.id), idempotencyKey: randomUUID(), reason: "PRIVATE-EFFECTIVE-REASON", source: "PRIVATE-EFFECTIVE-SOURCE" };
  return { company, run, who, command };
}

it("serializes identical retries into one encrypted history and audit, preserves captured pay and pins the baseline", async () => {
  const f = await fixture();
  const capturedBefore = await admin.from("calculations").select("id,calculation_hash,snapshot_enc").eq("run_id", f.run.runId).single();
  const results = await Promise.all([scheduleCompensation(admin, f.who, f.run.workerId, f.command), scheduleCompensation(admin, f.who, f.run.workerId, f.command)]);
  expect(results[0]).toEqual(results[1]);
  const rows = await admin.from("effective_compensations").select("id,payload_enc").eq("company_id", f.company.id);
  expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1); expect(JSON.stringify(rows.data)).not.toContain("PRIVATE-");
  const view = await loadEffectiveCompensation(admin, f.who, f.run.workerId, { period: { start: "2026-10-01", end: "2026-10-31" } });
  expect(view.segments).toHaveLength(2); expect(view.baseline.id).toBe(f.command.baselineCompensationId);
  expect(view.history[0]).toMatchObject({ reason: f.command.reason, source: f.command.source });
  const audit = await admin.from("audit_events").select("refs").eq("company_id", f.company.id).eq("event", "compensation.scheduled");
  expect(audit.data).toHaveLength(1); expect(JSON.stringify(audit.data)).not.toContain("PRIVATE-"); expect(JSON.stringify(audit.data)).not.toContain(f.command.baseAmount);
  expect((await admin.from("calculations").select("id,calculation_hash,snapshot_enc").eq("run_id", f.run.runId).single()).data).toEqual(capturedBefore.data);
  await expect(addCompensationVersion({ ...f.who, correlationId: randomUUID() }, f.run.workerId, { baseAmount: 1n, hourlyRate: 0n })).rejects.toThrow("effective compensation history");
  expect((await admin.from("workers").update({ pay_type: "HOURLY" }).eq("id", f.run.workerId)).error).not.toBeNull();
  expect((await admin.from("effective_compensations").update({ effective_from: "2026-10-17" }).eq("id", results[0].id!)).error).not.toBeNull();
  expect((await admin.from("effective_compensations").delete().eq("id", results[0].id!)).error).not.toBeNull();
});

it("requires explicit same-date supersession, rejects stale previews and changed retries, and gates revoked reads/retries", async () => {
  const f = await fixture(), first = await scheduleCompensation(admin, f.who, f.run.workerId, f.command);
  await expect(scheduleCompensation(admin, f.who, f.run.workerId, { ...f.command, reason: "Different command" })).rejects.toThrow("Retry key");
  await expect(scheduleCompensation(admin, f.who, f.run.workerId, { ...f.command, idempotencyKey: randomUUID() })).rejects.toThrow();
  const corrected = { ...f.command, expectedRevision: 1, supersedesId: first.id!, idempotencyKey: randomUUID(), baseAmount: parseUsdc("6500").toString() };
  expect((await scheduleCompensation(admin, f.who, f.run.workerId, corrected)).revision).toBe(2);
  const view = await loadEffectiveCompensation(admin, f.who, f.run.workerId, { period: { start: "2026-10-01", end: "2026-10-31" } });
  expect(view.history).toHaveLength(2); expect(view.segments?.at(-1)?.baseAmount).toBe(corrected.baseAmount);
  const own = await userClient(f.company.payment), foreignCompany = await makeCompany(), foreign = await userClient(foreignCompany.payroll);
  expect((await own.from("effective_compensations").select("id").eq("company_id", f.company.id)).data).toHaveLength(2);
  expect((await foreign.from("effective_compensations").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  expect((await own.from("effective_compensations").insert({ id: randomUUID() })).error).not.toBeNull();
  expect((await own.rpc("schedule_effective_compensation", { p_company: f.company.id, p_worker: f.run.workerId, p_actor: f.company.payment.id, p_correlation: randomUUID(), p_event: {} })).error).not.toBeNull();
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", f.company.id).eq("user_id", f.who.userId)).error).toBeNull();
  await expect(scheduleCompensation(admin, f.who, f.run.workerId, f.command)).rejects.toThrow("Current membership");
  await expect(loadEffectiveCompensation(admin, f.who, f.run.workerId)).rejects.toThrow("Current membership");
});

it("fences captured schedule revisions at calculation commit without inserting guard metadata into old snapshots", async () => {
  const f = await fixture();
  const newWorker = await createWorker(f.who, { pseudonym: "W-new", payType: "SALARIED", compensation: { baseAmount: parseUsdc("3100"), hourlyRate: 0n } });
  const newRun = await admin.from("payroll_runs").insert({ company_id: f.company.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-31", config_version: f.run.config.version, created_by: f.who.userId }).select("id").single();
  expect(newRun.error).toBeNull();
  const timeline = await loadEffectiveCompensation(admin, f.who, newWorker.id, { effectiveFrom: "2026-10-16" });
  await scheduleCompensation(admin, f.who, newWorker.id, { ...f.command, baselineCompensationId: timeline.baseline.id, baselineCompensationVersion: timeline.baseline.version, impactedRunIds: timeline.impacts.map(value => value.id), idempotencyKey: randomUUID() });
  const view = await loadEffectiveCompensation(admin, f.who, newWorker.id, { period: { start: "2026-10-01", end: "2026-10-31" } });
  const config = { ...f.run.config, deductions: [], prorationMethod: "ACTUAL_CALENDAR_DAYS" as const };
  const entries: EngineEntry[] = [{ worker: { workerId: newWorker.id, payType: "SALARIED", baseAmount: parseUsdc("3100"), hourlyRate: 0n }, period: { start: "2026-10-01", end: "2026-10-31" }, input: {}, compensationSegments: view.segments! }];
  const calc = calculatePayroll(config, entries);
  await expect(saveCalculation(f.company.id, newRun.data!.id, config, entries, calc, {}, { [newWorker.id]: 0 }, f.who.userId)).rejects.toThrow("db calculation save failed");
  expect((await admin.from("calculations").select("id").eq("run_id", newRun.data!.id)).data).toEqual([]);
  await expect(saveCalculation(f.company.id, newRun.data!.id, config, entries, calc, {}, { [newWorker.id]: 1 }, f.company.payment.id)).rejects.toThrow("db calculation save failed");
  const saved = await saveCalculation(f.company.id, newRun.data!.id, config, entries, calc, {}, { [newWorker.id]: 1 }, f.who.userId);
  const row = (await admin.from("calculations").select("snapshot_enc").eq("id", saved.calculationId).single()).data!;
  const snapshot = await openJson<Record<string, unknown>>(f.company.id, "calculations", "snapshot_enc", saved.calculationId, row.snapshot_enc);
  expect(snapshot).not.toHaveProperty("compensation_revisions"); expect(snapshot.entries).toEqual(JSON.parse(JSON.stringify(entries, (_key, value) => typeof value === "bigint" ? value.toString() : value)));
});

it("declares financial-only read, no public writes and immutable truncate guard in the actual catalog", async () => {
  const result = await admin.rpc("security_inventory"); expect(result.error).toBeNull();
  expect(result.data.find((row: { table_name: string }) => row.table_name === "effective_compensations")).toMatchObject({ rls_enabled: true, company_id_not_null: true, authenticated_select: true, authenticated_write: false, anon_any: false, truncate_guarded: true });
});
