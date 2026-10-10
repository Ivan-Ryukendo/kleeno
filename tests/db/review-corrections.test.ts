// Authored isolated-database acceptance. Do not execute against remote .env or infer migration acceptance from this file.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { runMachine, type RunState } from "@/core/domain/machines";
import { saveCalculation } from "@/server/db/calculations";
import { runStore } from "@/server/db/runs";
import { payrollReviewAction } from "@/server/db/payroll-review";
import { linkReviewCorrection, loadReviewCorrections } from "@/server/db/review-corrections";
import { POST } from "@/app/api/runs/[id]/corrections/route";
import { admin, call, cookieFor, makeCompany, pendingRun, step, userClient, withId } from "./helpers";

async function fixture() {
  const company = await makeCompany({ live: true }), original = await pendingRun(company);
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  async function ready(runId: string) {
    expect((await admin.from("import_batches").insert({ company_id: company.id, run_id: runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: company.payroll.id })).error).toBeNull();
    expect((await admin.from("payroll_review_settings").insert({ company_id: company.id, run_id: runId, revision: 1, cutoff_at: new Date(Date.now() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], fresh_after: null, updated_by: company.payroll.id })).error).toBeNull();
  }
  await ready(original.runId);
  const signed = await payrollReviewAction(admin, who, original.runId, { action: "signoff", idempotencyKey: randomUUID(), expectedRevision: 0, calculationId: original.saved.calculationId, calculationHash: original.calc.calculationHash });
  async function replacement(amount = 2000000000n) {
    const inserted = await admin.from("payroll_runs").insert({ company_id: company.id, mode: "SIMULATION", period_start: "2026-10-01", period_end: "2026-10-31", config_version: original.config.version, created_by: company.payroll.id }).select("id").single();
    expect(inserted.error).toBeNull(); const runId = inserted.data!.id;
    await step<RunState>(runStore, runMachine, company, runId, ["import_data", "start_reconciliation", "finish_reconciliation", "calculate"]);
    const entries: EngineEntry[] = [{ worker: { workerId: original.workerId, payType: "SALARIED", baseAmount: amount, hourlyRate: 0n }, input: { workedHours: "160" }, period: { start: "2026-10-01", end: "2026-10-31" } }];
    const calculated = calculatePayroll(original.config, entries), saved = await saveCalculation(company.id, runId, original.config, entries, calculated);
    await step<RunState>(runStore, runMachine, company, runId, ["validate_calculation"]);
    return { runId, calculated, saved };
  }
  const target = await replacement();
  const command = { replacementRunId: target.runId, originalCalculationId: original.saved.calculationId, replacementCalculationId: target.saved.calculationId, originalCalculationHash: original.calc.calculationHash, replacementCalculationHash: target.calculated.calculationHash, originalReviewRevision: signed.view.revision, replacementReviewRevision: 0 as const, idempotencyKey: randomUUID(), reason: "PRIVATE-CORRECTION-REASON", source: "PRIVATE-CORRECTION-SOURCE" };
  return { company, original, target, signed, who, command, ready, replacement };
}

it("atomically links/retries once, preserves original signed result, captures encrypted exact delta and requires fresh simulation review", async () => {
  const f = await fixture();
  const before = await admin.from("payroll_runs").select("status").in("id", [f.original.runId, f.target.runId]).order("id");
  const result = await Promise.all([linkReviewCorrection(admin, f.who, f.original.runId, f.command), linkReviewCorrection(admin, f.who, f.original.runId, f.command)]);
  expect(result[0]).toEqual(result[1]);
  expect((await admin.from("review_corrections").select("id,payload_enc").eq("company_id", f.company.id)).data).toHaveLength(1);
  const row = (await admin.from("review_corrections").select("payload_enc").eq("id", result[0].id!).single()).data!;
  expect(row.payload_enc).not.toContain("PRIVATE-CORRECTION");
  const lineage = await loadReviewCorrections(admin, f.who, f.original.runId);
  expect(lineage.links[0].delta.totals.net).toBe((f.target.calculated.totals.net - f.original.calc.totals.net).toString());
  expect(lineage.canLink).toBe(false);
  expect((await admin.from("audit_events").select("refs").eq("company_id", f.company.id).eq("event", "review.correction_linked")).data).toHaveLength(1);
  expect(JSON.stringify((await admin.from("audit_events").select("refs").eq("company_id", f.company.id).eq("event", "review.correction_linked")).data)).not.toContain("PRIVATE-");
  expect((await admin.from("payroll_runs").select("status").in("id", [f.original.runId, f.target.runId]).order("id")).data).toEqual(before.data);
  expect((await admin.from("payroll_review_events").select("id").eq("run_id", f.original.runId).eq("action", "SIGNOFF")).data?.[0].id).toBe(f.signed.view.signoff!.id);
  expect((await admin.from("payroll_review_events").select("id").eq("run_id", f.target.runId)).data).toEqual([]);
  await expect(step<RunState>(runStore, runMachine, f.company, f.target.runId, ["submit_for_approval"])).rejects.toThrow();
  await f.ready(f.target.runId);
  const fresh = await payrollReviewAction(admin, f.who, f.target.runId, { action: "signoff", idempotencyKey: randomUUID(), expectedRevision: 0, calculationId: f.target.saved.calculationId, calculationHash: f.target.calculated.calculationHash });
  expect(fresh.view.signoff?.id).not.toBe(f.signed.view.signoff!.id);
  await payrollReviewAction(admin, f.who, f.target.runId, { action: "export", idempotencyKey: randomUUID(), expectedRevision: 1, calculationId: f.target.saved.calculationId, calculationHash: f.target.calculated.calculationHash });
  expect((await admin.from("obligations").select("id").eq("run_id", f.target.runId)).data).toEqual([]);
  expect(await linkReviewCorrection(admin, f.who, f.original.runId, f.command)).toEqual(result[0]);
  const next = await f.replacement(3000000000n);
  await linkReviewCorrection(admin, f.who, f.target.runId, { ...f.command, originalCalculationId: f.target.saved.calculationId, originalCalculationHash: f.target.calculated.calculationHash, originalReviewRevision: 2, replacementRunId: next.runId, replacementCalculationId: next.saved.calculationId, replacementCalculationHash: next.calculated.calculationHash, idempotencyKey: randomUUID() });
  expect((await loadReviewCorrections(admin, f.who, f.target.runId)).links).toHaveLength(2);
});

it("rejects duplicate outgoing links, stale bindings, target reuse, revoked retries and cross-tenant reads; exposes SELECT only", async () => {
  const f = await fixture();
  await expect(linkReviewCorrection(admin, f.who, f.original.runId, { ...f.command, originalReviewRevision: 9 })).rejects.toThrow();
  const linked = await linkReviewCorrection(admin, f.who, f.original.runId, f.command);
  await expect(linkReviewCorrection(admin, f.who, f.original.runId, { ...f.command, idempotencyKey: randomUUID(), reason: "Second attempt" })).rejects.toThrow();
  const anotherOriginal = await f.replacement(4000000000n); await f.ready(anotherOriginal.runId);
  await payrollReviewAction(admin, f.who, anotherOriginal.runId, { action: "signoff", idempotencyKey: randomUUID(), expectedRevision: 0, calculationId: anotherOriginal.saved.calculationId, calculationHash: anotherOriginal.calculated.calculationHash });
  await expect(linkReviewCorrection(admin, f.who, anotherOriginal.runId, { ...f.command, originalCalculationId: anotherOriginal.saved.calculationId, originalCalculationHash: anotherOriginal.calculated.calculationHash, originalReviewRevision: 1, idempotencyKey: randomUUID() })).rejects.toThrow();
  const own = await userClient(f.company.payment), foreignCompany = await makeCompany(), foreign = await userClient(foreignCompany.payroll);
  expect((await own.from("review_corrections").select("id").eq("company_id", f.company.id)).data).toHaveLength(1);
  expect((await foreign.from("review_corrections").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  expect((await own.from("review_corrections").insert({ id: randomUUID() })).error).not.toBeNull();
  expect((await admin.from("review_corrections").update({ original_review_revision: 9 }).eq("id", linked.id!)).error).not.toBeNull();
  expect((await admin.from("review_corrections").delete().eq("id", linked.id!)).error).not.toBeNull();
  expect((await own.rpc("link_review_correction", { p_company: f.company.id, p_run: f.original.runId, p_actor: f.company.payment.id, p_correlation: randomUUID(), p_event: {} })).error).not.toBeNull();
  const { cookie } = await cookieFor(f.company.payment);
  expect((await call(POST, { cookie, body: f.command }, withId(f.original.runId))).status).toBe(403);
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", f.company.id).eq("user_id", f.who.userId)).error).toBeNull();
  await expect(linkReviewCorrection(admin, f.who, f.original.runId, f.command)).rejects.toThrow("Current membership");
});

it("rechecks exact evidence and current roles inside the service transaction, with no partial link or audit on rejection", async () => {
  const f = await fixture();
  const event = {
    id: randomUUID(), replacement_run_id: f.target.runId,
    original_calculation_id: f.original.saved.calculationId, replacement_calculation_id: f.target.saved.calculationId,
    original_calculation_hash: f.original.calc.calculationHash, replacement_calculation_hash: f.target.calculated.calculationHash,
    original_signoff_id: f.signed.view.signoff!.id, original_review_revision: 1, replacement_review_revision: 0,
    idempotency_key: randomUUID(), command_hash: "f".repeat(64), payload_enc: "synthetic-unused-ciphertext",
  };
  const rpc = (patch: Partial<typeof event>, actor = f.who.userId) => admin.rpc("link_review_correction", {
    p_company: f.company.id, p_run: f.original.runId, p_actor: actor, p_correlation: randomUUID(), p_event: { ...event, ...patch },
  });
  for (const patch of [
    { original_review_revision: 0 }, { replacement_review_revision: 1 },
    { original_signoff_id: randomUUID() }, { original_calculation_id: randomUUID() },
    { replacement_calculation_hash: "c".repeat(64) },
  ]) {
    const result = await rpc(patch);
    expect(result.error).toBeNull(); expect(result.data).toEqual({ code: "CONFLICT" });
  }
  const forbidden = await rpc({}, f.company.payment.id);
  expect(forbidden.error).toBeNull(); expect(forbidden.data).toEqual({ code: "FORBIDDEN" });
  const foreign = await fixture();
  const cross = await rpc({ replacement_run_id: foreign.target.runId });
  expect(cross.error).toBeNull(); expect(cross.data).toEqual({ code: "NOT_FOUND" });
  expect((await admin.from("review_corrections").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  expect((await admin.from("audit_events").select("id").eq("company_id", f.company.id).eq("event", "review.correction_linked")).data).toEqual([]);
});

it("serializes a replacement sign-off racing a link and rejects subsequent stale links", async () => {
  const f = await fixture(); await f.ready(f.target.runId);
  const results = await Promise.allSettled([
    linkReviewCorrection(admin, f.who, f.original.runId, f.command),
    payrollReviewAction(admin, f.who, f.target.runId, { action: "signoff", idempotencyKey: randomUUID(), expectedRevision: 0, calculationId: f.target.saved.calculationId, calculationHash: f.target.calculated.calculationHash }),
  ]);
  // Linking may win first; sign-off remains a separate fresh human action. If sign-off wins, linking must reject.
  expect(results[1].status).toBe("fulfilled");
  const links = await admin.from("review_corrections").select("id").eq("company_id", f.company.id);
  expect(links.error).toBeNull(); expect(links.data).toHaveLength(results[0].status === "fulfilled" ? 1 : 0);
  await expect(linkReviewCorrection(admin, f.who, f.original.runId, { ...f.command, idempotencyKey: randomUUID() })).rejects.toThrow();
  const audit = await admin.from("audit_events").select("id").eq("company_id", f.company.id).eq("event", "review.correction_linked");
  expect(audit.error).toBeNull(); expect(audit.data).toHaveLength(links.data!.length);
  expect((await admin.from("obligations").select("id").eq("run_id", f.target.runId)).data).toEqual([]);
});

it("declares correction tenant isolation, public write denial and truncate protection in the actual database catalog", async () => {
  const result = await admin.rpc("security_inventory");
  expect(result.error).toBeNull();
  expect(result.data.find((row: { table_name: string }) => row.table_name === "review_corrections")).toMatchObject({
    rls_enabled: true, has_company_id: true, company_id_not_null: true,
    anon_any: false, authenticated_select: true, authenticated_write: false, truncate_guarded: true,
  });
});
