// Real transaction/constraint acceptance; run only on the disposable target enforced by vitest.db.config.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calculatePayroll } from "@/core/engine";
import { exceptionMachine, runMachine } from "@/core/domain/machines";
import { WorkerMetadataSchema } from "@/core/workers";
import { openField, openJson, sealField, sealJson } from "@/server/crypto";
import { configAction, createConfigDraft } from "@/server/db/configs";
import { loadRunAdjustments, setRunAdjustments } from "@/server/db/calculate";
import { saveCalculation } from "@/server/db/calculations";
import { runStore } from "@/server/db/runs";
import { dbStore } from "@/server/db/store";
import { createWorker, updateWorkerMetadata } from "@/server/db/workers";
import { activeConfig, admin, CONFIG_PARAMS, makeCompany, step, userClient } from "./helpers";

async function fixture() {
  const company = await makeCompany();
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const cfg = await activeConfig(company);
  const worker = await createWorker(who, { pseudonym: "W001", payType: "SALARIED", compensation: { baseAmount: 10n, hourlyRate: 0n } });
  const run = await admin.from("payroll_runs").insert({ company_id: company.id, mode: "SIMULATION", config_version: cfg.version, period_start: "2026-10-01", period_end: "2026-10-31", created_by: who.userId }).select("id").single();
  expect(run.error).toBeNull();
  return { company, who, cfg, workerId: worker.id, runId: run.data!.id as string };
}
async function events(companyId: string, entityId: string, event: string) {
  const out = await admin.from("audit_events").select("id,refs,correlation_id").eq("company_id", companyId).eq("entity_id", entityId).eq("event", event);
  expect(out.error).toBeNull(); return out.data!;
}

describe("R6.2 concurrent edits", () => {
  it("serializes approved config activations with one active version and intact immutable payloads/audit", async () => {
    const company = await makeCompany(), initial = await activeConfig(company);
    const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles };
    const drafts = [];
    for (const multiplier of ["1.5", "2"]) {
      const draft = await createConfigDraft(who, { params: { ...CONFIG_PARAMS, overtimeMultiplier: multiplier }, clauses: [{ id: "C1", text: "Synthetic concurrency policy" }] });
      for (const action of ["validate", "request_review", "approve"]) await configAction(who, draft.id, action);
      drafts.push(draft);
    }
    const before = await admin.from("payroll_configurations").select("id,params_enc,clauses_enc").eq("company_id", company.id).order("version");
    expect(before.error).toBeNull();
    expect(await Promise.all(drafts.map(draft => configAction({ ...who, correlationId: randomUUID() }, draft.id, "activate")))).toEqual(["ACTIVE", "ACTIVE"]);
    const after = await admin.from("payroll_configurations").select("id,status,params_enc,clauses_enc").eq("company_id", company.id).order("version");
    expect(after.error).toBeNull();
    expect(after.data!.map(({ id, params_enc, clauses_enc }) => ({ id, params_enc, clauses_enc }))).toEqual(before.data);
    expect(after.data!.filter(row => row.status === "ACTIVE")).toHaveLength(1);
    expect(after.data!.find(row => row.id === initial.id)?.status).toBe("SUPERSEDED");
    expect(after.data!.filter(row => row.status === "SUPERSEDED")).toHaveLength(2);
    for (const draft of drafts) expect(await events(company.id, draft.id, "config.activate")).toHaveLength(1);
    const superseded = after.data!.filter(row => row.status === "SUPERSEDED");
    for (const row of superseded) expect(await events(company.id, row.id, "config.supersede")).toHaveLength(1);
    expect((await admin.from("payroll_configurations").update({ params: CONFIG_PARAMS }).eq("id", drafts[0].id)).error).not.toBeNull();
  });

  it("keeps full worker metadata coherent under documented last-writer semantics", async () => {
    const f = await fixture();
    const metadata = [
      WorkerMetadataSchema.parse({ department: "A", employmentStart: "2026-01-01", employmentEnd: "2026-06-30" }),
      WorkerMetadataSchema.parse({ department: "B", employmentStart: "2026-07-01", employmentEnd: "2026-12-31" }),
    ];
    expect(await Promise.all(metadata.map(value => updateWorkerMetadata({ ...f.who, correlationId: randomUUID() }, f.workerId, value)))).toEqual([true, true]);
    const result = await admin.from("workers").select("metadata_enc,employment_start,employment_end").eq("id", f.workerId).single();
    expect(result.error).toBeNull();
    const stored = await openJson<typeof metadata[0]>(f.company.id, "workers", "metadata_enc", f.workerId, result.data!.metadata_enc);
    expect(metadata).toContainEqual(stored);
    expect(result.data).toMatchObject({ employment_start: stored.employmentStart, employment_end: stored.employmentEnd });
    const audit = await events(f.company.id, f.workerId, "worker.metadata");
    expect(audit).toHaveLength(2); expect(new Set(audit.map(e => e.correlation_id)).size).toBe(2);
  });

  it("one same-head compensation wins, pairing its pay type/history/audit while rejecting stale and unauthorized commands", async () => {
    const f = await fixture();
    const before = await admin.from("compensations").select("id,version,payload_enc").eq("worker_id", f.workerId).single();
    expect(before.error).toBeNull();
    const commands = await Promise.all((["HOURLY", "RETAINER"] as const).map(async (type, i) => {
      const id = randomUUID();
      return { p_company: f.company.id, p_worker: f.workerId, p_actor: f.who.userId, p_correlation: randomUUID(), p_event: { id, expected_version: 1, pay_type: type, reason: "ROLE_CHANGE", payload_enc: await sealJson(f.company.id, "compensations", "payload_enc", id, { baseAmount: String(i * 20), hourlyRate: String((1 - i) * 10) }) } };
    }));
    const results = await Promise.all(commands.map(command => admin.rpc("append_immediate_compensation", command)));
    for (const result of results) expect(result.error).toBeNull();
    expect(results.map(r => r.data).sort()).toEqual(["CONFLICT", "OK"]);
    const winner = commands[results.findIndex(r => r.data === "OK")];
    const history = await admin.from("compensations").select("id,version,payload_enc").eq("worker_id", f.workerId).order("version");
    expect(history.error).toBeNull(); expect(history.data).toEqual([before.data, { id: winner.p_event.id, version: 2, payload_enc: winner.p_event.payload_enc }]);
    expect((await admin.from("workers").select("pay_type").eq("id", f.workerId).single()).data?.pay_type).toBe(winner.p_event.pay_type);
    const versionAudit = (await events(f.company.id, f.workerId, "compensation.version")).filter(e => e.refs.version === 2);
    expect(versionAudit).toHaveLength(1); expect(versionAudit[0].correlation_id).toBe(winner.p_correlation);
    const typeAudit = await events(f.company.id, f.workerId, "worker.pay_type");
    expect(typeAudit).toHaveLength(1); expect(typeAudit[0]).toMatchObject({ correlation_id: winner.p_correlation, refs: { from: "SALARIED", to: winner.p_event.pay_type } });
    expect((await admin.from("compensations").update({ payload_enc: "changed" }).eq("id", before.data!.id)).error).not.toBeNull();
    const fresh = { ...winner, p_event: { ...winner.p_event, id: randomUUID(), expected_version: 2 } };
    expect((await admin.rpc("append_immediate_compensation", { ...fresh, p_actor: f.company.payment.id })).data).toBe("FORBIDDEN");
    const foreign = await makeCompany();
    expect((await admin.rpc("append_immediate_compensation", { ...fresh, p_company: foreign.id, p_actor: foreign.payroll.id })).data).toBe("NOT_FOUND");
    expect((await (await userClient(f.company.payroll)).rpc("append_immediate_compensation", fresh)).error).not.toBeNull();
    // A failed immutable insert must not change pay type or append either audit event.
    expect((await admin.rpc("append_immediate_compensation", { ...fresh, p_event: { ...fresh.p_event, id: before.data!.id, pay_type: "SALARIED" } })).error?.code).toBe("23505");
    expect(await events(f.company.id, f.workerId, "worker.pay_type")).toEqual(typeAudit);
    expect((await admin.from("workers").select("pay_type").eq("id", f.workerId).single()).data?.pay_type).toBe(winner.p_event.pay_type);
  });

  it("serializes existing adjustment overwrites, increments both revisions and refuses a stale calculation atomically", async () => {
    const f = await fixture();
    const adjustments = [[{ id: "bonus-a", kind: "BONUS" as const, amount: "1", reason: "Synthetic first bonus" }], [{ id: "bonus-b", kind: "BONUS" as const, amount: "2", reason: "Synthetic second bonus" }]];
    await setRunAdjustments(f.who, f.runId, f.workerId, []);
    expect((await admin.from("payroll_runs").select("adjustment_revision").eq("id", f.runId).single()).data?.adjustment_revision).toBe(1);
    await Promise.all(adjustments.map(value => setRunAdjustments({ ...f.who, correlationId: randomUUID() }, f.runId, f.workerId, value)));
    expect(adjustments).toContainEqual((await loadRunAdjustments(admin, f.company.id, f.runId)).get(f.workerId));
    expect((await admin.from("payroll_runs").select("adjustment_revision").eq("id", f.runId).single()).data?.adjustment_revision).toBe(3);
    expect(await events(f.company.id, f.runId, "run.adjustments")).toHaveLength(3);
    const entries = [{ worker: { workerId: f.workerId, payType: "SALARIED" as const, baseAmount: 10n, hourlyRate: 0n }, input: { workedHours: "160" } }];
    await expect(saveCalculation(f.company.id, f.runId, f.cfg.config, entries, calculatePayroll(f.cfg.config, entries), { adjustmentRevision: 1 })).rejects.toThrow();
    expect((await admin.from("calculations").select("id").eq("run_id", f.runId)).data).toEqual([]);
  });

  it("one in-review exception decision wins with the exact encrypted note and terminal audit; loser cannot overwrite it", async () => {
    const f = await fixture();
    const row = await admin.from("exceptions").insert({ company_id: f.company.id, run_id: f.runId, worker_id: f.workerId, category: "DUPLICATE_TIMESHEET", severity: "HIGH", dedupe_key: "race", options: ["KEEP_FIRST", "KEEP_LATEST"] }).select("id").single();
    expect(row.error).toBeNull(); const id = row.data!.id;
    await step(dbStore("exceptions"), exceptionMachine, f.company, id, ["start_review"]);
    const commands = await Promise.all(["KEEP_FIRST", "KEEP_LATEST"].map(async (action, i) => ({ p_company: f.company.id, p_id: id, p_actor: f.who.userId, p_correlation: randomUUID(), p_action: action, p_resolution: await sealField(f.company.id, "exceptions", "resolution", id, `synthetic decision ${i}`) })));
    const results = await Promise.all(commands.map(command => admin.rpc("resolve_reconciliation_exception", command)));
    for (const result of results) expect(result.error).toBeNull();
    expect(results.map(r => r.data).sort()).toEqual(["OK", "STALE_STATE"]);
    const winnerIndex = results.findIndex(r => r.data === "OK"), winner = commands[winnerIndex];
    const stored = await admin.from("exceptions").select("status,resolution_action,resolution,resolved_by").eq("id", id).single();
    expect(stored.error).toBeNull(); expect(stored.data).toMatchObject({ status: "RESOLVED", resolution_action: winner.p_action, resolution: winner.p_resolution, resolved_by: f.who.userId });
    expect(await openField(f.company.id, "exceptions", "resolution", id, stored.data!.resolution)).toBe(`synthetic decision ${winnerIndex}`);
    const audit = await events(f.company.id, id, "exception.resolve");
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ correlation_id: winner.p_correlation, refs: { action: winner.p_action, runId: f.runId } });
    expect((await admin.from("exceptions").update({ resolution_action: "KEEP_ALL" }).eq("id", id)).error).not.toBeNull();
    expect((await admin.rpc("resolve_reconciliation_exception", { ...winner, p_actor: f.company.payment.id })).data).toBe("FORBIDDEN");
    expect((await admin.rpc("resolve_reconciliation_exception", { ...winner, p_action: "APPROVE_HOURS" })).data).toBe("FORBIDDEN");
    const foreign = await makeCompany();
    expect((await admin.rpc("resolve_reconciliation_exception", { ...winner, p_company: foreign.id, p_actor: foreign.payroll.id })).data).toBe("NOT_FOUND");
    expect((await (await userClient(f.company.payroll)).rpc("resolve_reconciliation_exception", winner)).error).not.toBeNull();
  });

  it("same-revision review commands have one immutable winner; exact replay adds no event or audit", async () => {
    const f = await fixture();
    expect((await admin.from("import_batches").insert({ company_id: f.company.id, run_id: f.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: f.who.userId })).error).toBeNull();
    await step(runStore, runMachine, f.company, f.runId, ["import_data", "start_reconciliation", "finish_reconciliation", "calculate"]);
    const entries = [{ worker: { workerId: f.workerId, payType: "SALARIED" as const, baseAmount: 10n, hourlyRate: 0n }, input: { workedHours: "160" } }];
    const calc = calculatePayroll(f.cfg.config, entries), saved = await saveCalculation(f.company.id, f.runId, f.cfg.config, entries, calc);
    await step(runStore, runMachine, f.company, f.runId, ["validate_calculation"]);
    expect((await admin.from("payroll_review_settings").insert({ company_id: f.company.id, run_id: f.runId, revision: 1, cutoff_at: new Date(Date.now() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], updated_by: f.who.userId })).error).toBeNull();
    const commands = ["a", "b"].map(hash => ({ p_company: f.company.id, p_run: f.runId, p_actor: f.who.userId, p_correlation: randomUUID(), p_event: { id: randomUUID(), action: "SIGNOFF", calculation_id: saved.calculationId, calculation_hash: calc.calculationHash, expected_revision: 0, idempotency_key: randomUUID(), command_hash: hash.repeat(64), settings_revision: 1, payload_enc: null } }));
    const results = await Promise.all(commands.map(command => admin.rpc("append_payroll_review", command)));
    for (const result of results) expect(result.error).toBeNull();
    expect(results.map(r => r.data.code).sort()).toEqual(["CONFLICT", "OK"]);
    const winner = commands[results.findIndex(r => r.data.code === "OK")];
    expect((await admin.rpc("append_payroll_review", winner)).data?.code).toBe("OK");
    expect((await admin.rpc("append_payroll_review", { ...winner, p_event: { ...winner.p_event, command_hash: "c".repeat(64) } })).data?.code).toBe("CONFLICT");
    const history = await admin.from("payroll_review_events").select("id,revision,calculation_hash").eq("run_id", f.runId);
    expect(history.error).toBeNull(); expect(history.data).toEqual([{ id: winner.p_event.id, revision: 1, calculation_hash: calc.calculationHash }]);
    expect(await events(f.company.id, winner.p_event.id, "review.signoff")).toHaveLength(1);
    expect((await admin.from("payroll_review_events").update({ revision: 2 }).eq("id", winner.p_event.id)).error).not.toBeNull();
    expect((await admin.from("payroll_approvals").select("id").eq("run_id", f.runId)).data).toEqual([]);
    expect((await admin.from("obligations").select("id").eq("run_id", f.runId)).data).toEqual([]);
  });
});
