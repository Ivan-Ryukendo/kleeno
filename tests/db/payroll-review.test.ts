// Isolated database acceptance only; authored tests are not runtime proof until this suite executes.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { payrollReviewAction, loadPayrollReview, downloadReviewExport } from "@/server/db/payroll-review";
import { POST } from "@/app/api/runs/[id]/review/route";
import { admin, call, cookieFor, makeCompany, pendingRun, userClient, withId } from "./helpers";

async function fixture(withSettings = true) {
  const company = await makeCompany({ live: true });
  const run = await pendingRun(company);
  const at = new Date().toISOString();
  expect((await admin.from("import_batches").insert({ company_id: company.id, run_id: run.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: company.payroll.id, created_at: at })).error).toBeNull();
  if (withSettings) expect((await admin.from("payroll_review_settings").insert({ company_id: company.id, run_id: run.runId, revision: 1, cutoff_at: new Date(Date.now() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], fresh_after: null, updated_by: company.payroll.id })).error).toBeNull();
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const bound = { calculationId: run.saved.calculationId, calculationHash: run.calc.calculationHash };
  const raw = (revision: number, overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), action: "SIGNOFF", calculation_id: bound.calculationId, calculation_hash: bound.calculationHash, expected_revision: revision, idempotency_key: randomUUID(), command_hash: "a".repeat(64), settings_revision: 1, payload_enc: null, ...overrides });
  const rpc = (event: ReturnType<typeof raw>, actor = who.userId, runId = run.runId) => admin.rpc("append_payroll_review", { p_company: company.id, p_run: runId, p_actor: actor, p_correlation: who.correlationId, p_event: event });
  return { company, run, who, bound, raw, rpc };
}

it("atomically signs one exact calculation, reproduces CSV and encrypts manual evidence without granting payroll authority", async () => {
  const f = await fixture();
  const signed = await payrollReviewAction(admin, f.who, f.run.runId, { ...f.bound, action: "signoff", expectedRevision: 0, idempotencyKey: randomUUID() });
  expect(signed.view).toMatchObject({ revision: 1, calculationHash: f.bound.calculationHash, export: null });
  const exported = await payrollReviewAction(admin, f.who, f.run.runId, { ...f.bound, action: "export", expectedRevision: 1, idempotencyKey: randomUUID() });
  expect(exported.view.export?.totals.net).toBe(f.run.calc.totals.net.toString());
  expect(await downloadReviewExport(admin, f.company.id, f.run.runId)).toEqual(exported.download);
  for (const [index, status] of ["UNKNOWN", "MANUAL_REJECTED", "MANUAL_ACCEPTED"].entries()) {
    await payrollReviewAction(admin, f.who, f.run.runId, { ...f.bound, action: "acknowledge", expectedRevision: 2 + index, idempotencyKey: randomUUID(), status: status as "UNKNOWN" | "MANUAL_REJECTED" | "MANUAL_ACCEPTED", reference: "PRIVATE-RECEIPT-123" });
  }
  expect((await loadPayrollReview(admin, f.company.id, f.run.runId)).acknowledgement).toMatchObject({ status: "MANUAL_ACCEPTED", reference: "PRIVATE-RECEIPT-123" });
  const rows = (await admin.from("payroll_review_events").select("*").eq("run_id", f.run.runId)).data!;
  expect(rows).toHaveLength(5);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE-RECEIPT-123");
  const audit = (await admin.from("audit_events").select("*").eq("entity_type", "review").eq("company_id", f.company.id)).data!;
  expect(audit).toHaveLength(5);
  expect(JSON.stringify(audit)).not.toContain("PRIVATE-RECEIPT-123");
  expect((await admin.from("payroll_runs").select("status").eq("id", f.run.runId).single()).data?.status).toBe("PENDING_APPROVAL");
  for (const table of ["payroll_approvals", "obligations", "payment_batches"]) expect((await admin.from(table).select("id").eq("run_id", f.run.runId)).data).toEqual([]);
});

it("reuses identical command keys, rejects changed payloads and serializes competing revisions", async () => {
  const f = await fixture(), event = f.raw(0);
  const first = await f.rpc(event), second = await f.rpc(event);
  expect(first.error).toBeNull(); expect(first.data).toEqual({ code: "OK", id: event.id }); expect(second.data).toEqual(first.data);
  expect((await f.rpc({ ...event, command_hash: "b".repeat(64) })).data?.code).toBe("CONFLICT");
  expect((await f.rpc(f.raw(0))).data?.code).toBe("CONFLICT");
  const other = await fixture();
  const results = await Promise.all([other.rpc(other.raw(0)), other.rpc(other.raw(0))]);
  expect(results.map(result => result.data?.code).sort()).toEqual(["CONFLICT", "OK"]);
  expect((await admin.from("payroll_review_events").select("id").eq("run_id", other.run.runId)).data).toHaveLength(1);
});

it("rejects foreign hashes/calculations, absent readiness, stale settings and current role revocation", async () => {
  const f = await fixture();
  expect((await f.rpc(f.raw(0, { calculation_hash: "b".repeat(64) }))).data?.code).toBe("CONFLICT");
  expect((await f.rpc(f.raw(0, { calculation_id: randomUUID() }))).data?.code).toBe("NOT_FOUND");
  expect((await f.rpc(f.raw(0, { settings_revision: 2 }))).data?.code).toBe("CONFLICT");
  const foreign = await makeCompany();
  expect((await f.rpc(f.raw(0), foreign.payroll.id)).data?.code).toBe("FORBIDDEN");
  const missing = await fixture(false);
  expect((await missing.rpc(missing.raw(0))).data?.code).toBe("NOT_READY");
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", f.company.id).eq("user_id", f.who.userId)).error).toBeNull();
  expect((await f.rpc(f.raw(0))).data?.code).toBe("FORBIDDEN");
});

it("freezes signed readiness settings, rejects unauthorized setting writes and scopes settings reads", async () => {
  const f = await fixture();
  expect((await f.rpc(f.raw(0))).data?.code).toBe("OK");
  expect((await admin.from("payroll_review_settings").update({ revision: 2, cutoff_at: new Date(Date.now() + 7200000).toISOString() }).eq("company_id", f.company.id).eq("run_id", f.run.runId)).error).not.toBeNull();
  expect((await admin.from("payroll_review_settings").delete().eq("run_id", f.run.runId)).error).not.toBeNull();
  const settingsCommand = { p_company: f.company.id, p_run: f.run.runId, p_actor: f.company.payment.id, p_expected_revision: 1, p_cutoff: new Date(Date.now() + 3600000).toISOString(), p_timezone: "UTC", p_types: ["TIMESHEETS"], p_fresh_after: null, p_correlation: randomUUID() };
  expect((await admin.rpc("save_payroll_review_settings", settingsCommand)).error).not.toBeNull();
  const own = await userClient(f.company.payment), foreign = await userClient((await makeCompany()).payroll);
  expect((await own.from("payroll_review_settings").select("revision").eq("run_id", f.run.runId)).data).toHaveLength(1);
  expect((await foreign.from("payroll_review_settings").select("revision").eq("run_id", f.run.runId)).data).toEqual([]);
  expect((await own.from("payroll_review_settings").update({ revision: 2 }).eq("run_id", f.run.runId)).error).not.toBeNull();
  expect((await own.from("payroll_review_settings").delete().eq("run_id", f.run.runId)).error).not.toBeNull();
  expect((await own.rpc("save_payroll_review_settings", settingsCommand)).error).not.toBeNull();
});

it("enforces immutable history, tenant RLS, SELECT-only public access and authenticated route roles", async () => {
  const f = await fixture();
  await f.rpc(f.raw(0));
  expect((await admin.from("payroll_review_events").update({ revision: 9 }).eq("run_id", f.run.runId)).error).not.toBeNull();
  expect((await admin.from("payroll_review_events").delete().eq("run_id", f.run.runId)).error).not.toBeNull();
  const own = await userClient(f.company.payment), foreign = await userClient((await makeCompany()).payroll);
  expect((await own.from("payroll_review_events").select("id").eq("run_id", f.run.runId)).data).toHaveLength(1);
  expect((await foreign.from("payroll_review_events").select("id").eq("run_id", f.run.runId)).data).toEqual([]);
  expect((await own.from("payroll_review_events").insert({ id: randomUUID() })).error).not.toBeNull();
  expect((await own.rpc("append_payroll_review", { p_company: f.company.id, p_run: f.run.runId, p_actor: f.company.payment.id, p_correlation: randomUUID(), p_event: f.raw(1) })).error).not.toBeNull();
  const { cookie } = await cookieFor(f.company.payment);
  expect((await call(POST, { cookie, body: { ...f.bound, action: "signoff", expectedRevision: 1, idempotencyKey: randomUUID() } }, withId(f.run.runId))).status).toBe(403);
});
