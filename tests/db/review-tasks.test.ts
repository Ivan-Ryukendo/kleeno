// Authored isolated acceptance; never execute against the remote development .env target.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { reviewTaskAction, loadReviewTasks } from "@/server/db/review-tasks";
import { POST } from "@/app/api/runs/[id]/tasks/route";
import { admin, call, cookieFor, makeCompany, pendingRun, userClient, withId } from "./helpers";

async function fixture() {
  const company = await makeCompany({ live: true }), run = await pendingRun(company);
  expect((await admin.from("payroll_review_settings").insert({ company_id: company.id, run_id: run.runId, revision: 1, cutoff_at: new Date(Date.now() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], updated_by: company.payroll.id })).error).toBeNull();
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const create = { action: "create" as const, taskId: randomUUID(), idempotencyKey: randomUUID(), expectedRevision: 0 as const, source: { kind: "MISSING_EVIDENCE" as const, importType: "TIMESHEETS" as const }, assigneeId: who.userId, dueAt: new Date(Date.now() + 3600000).toISOString(), severity: "HIGH" as const, status: "OPEN" as const, nextAction: "PRIVATE-task-request", evidenceRefs: ["PRIVATE-evidence-ref"] };
  const raw = (change: Record<string, unknown> = {}) => ({ id: create.taskId, task_id: create.taskId, action: "create", expected_revision: 0, source_kind: "MISSING_EVIDENCE", import_type: "TIMESHEETS", assignee_id: who.userId, due_at: create.dueAt, severity: "HIGH", status: "OPEN", payload_enc: "encrypted-test-envelope", idempotency_key: randomUUID(), command_hash: "a".repeat(64), ...change });
  const rpc = (event: Record<string, unknown>, actor = who.userId, runId = run.runId) => admin.rpc("append_review_task", { p_company: company.id, p_run: runId, p_actor: actor, p_correlation: who.correlationId, p_event: event });
  return { company, run, who, create, raw, rpc };
}

it("preserves encrypted ownership history without resolving exceptions or granting financial authority", async () => {
  const f = await fixture();
  await reviewTaskAction(admin, f.who, f.run.runId, f.create);
  const { source, ...state } = f.create;
  await reviewTaskAction(admin, f.who, f.run.runId, { ...state, action: "update", expectedRevision: 1, idempotencyKey: randomUUID(), status: "RESOLVED", nextAction: "PRIVATE-task-complete" });
  const view = await loadReviewTasks(admin, f.who, f.run.runId);
  expect(view.tasks[0].source).toEqual(source);
  expect(view.tasks[0]).toMatchObject({ revision: 2, status: "RESOLVED", assigneeAvailable: true });
  expect(view.tasks[0].history.map(e => e.nextAction)).toEqual(["PRIVATE-task-request", "PRIVATE-task-complete"]);
  const rows = await admin.from("review_task_events").select("*").eq("run_id", f.run.runId);
  expect(rows.data).toHaveLength(2); expect(JSON.stringify(rows.data)).not.toContain("PRIVATE-");
  const audit = await admin.from("audit_events").select("*").eq("company_id", f.company.id).eq("entity_type", "review_task");
  expect(audit.data).toHaveLength(2); expect(JSON.stringify(audit.data)).not.toContain("PRIVATE-");
  expect((await admin.from("payroll_runs").select("status").eq("id", f.run.runId).single()).data?.status).toBe("PENDING_APPROVAL");
  for (const table of ["payroll_approvals", "obligations", "payment_batches", "payroll_review_events"]) expect((await admin.from(table).select("id").eq("run_id", f.run.runId)).data).toEqual([]);
});

it("serializes revisions and rejects changed retry payload, immutable source edits and foreign sources", async () => {
  const f = await fixture(), event = f.raw();
  expect((await f.rpc(event)).data).toEqual({ code: "OK", id: event.id });
  expect((await f.rpc(event)).data).toEqual({ code: "OK", id: event.id });
  expect((await f.rpc({ ...event, command_hash: "b".repeat(64) })).data?.code).toBe("CONFLICT");
  const update = f.raw({ action: "update", id: randomUUID(), expected_revision: 1 });
  expect((await f.rpc(update)).data?.code).toBe("CONFLICT");
  const safe: Record<string, unknown> = { ...update }; delete safe.source_kind; delete safe.import_type;
  const racing = await Promise.all([f.rpc(safe), f.rpc({ ...safe, id: randomUUID(), idempotency_key: randomUUID() })]);
  expect(racing.map(r => r.data?.code).sort()).toEqual(["CONFLICT", "OK"]);
  const another = await fixture();
  expect((await another.rpc(another.raw({ source_kind: "EXCEPTION", import_type: null, exception_id: randomUUID() }))).data?.code).toBe("SOURCE_UNAVAILABLE");
  expect((await another.rpc(another.raw({ import_type: "LEAVE" }))).data?.code).toBe("SOURCE_UNAVAILABLE");
  expect((await another.rpc(another.raw(), f.who.userId)).data?.code).toBe("FORBIDDEN");
});

it("checks current actor and assignee roles, scopes reads and blocks public/direct immutable writes", async () => {
  const f = await fixture(), event = f.raw();
  expect((await f.rpc(f.raw({ assignee_id: f.company.payment.id }))).data?.code).toBe("ASSIGNEE_UNAVAILABLE");
  expect((await f.rpc(event)).data?.code).toBe("OK");
  const own = await userClient(f.company.payroll), payment = await userClient(f.company.payment), foreign = await userClient((await makeCompany()).payroll);
  expect((await own.from("review_task_events").select("id").eq("run_id", f.run.runId)).data).toHaveLength(1);
  expect((await payment.from("review_task_events").select("id").eq("run_id", f.run.runId)).data).toEqual([]);
  expect((await foreign.from("review_task_events").select("id").eq("run_id", f.run.runId)).data).toEqual([]);
  for (const client of [own, admin]) {
    expect((await client.from("review_task_events").update({ status: "RESOLVED" }).eq("run_id", f.run.runId)).error).not.toBeNull();
    expect((await client.from("review_task_events").delete().eq("run_id", f.run.runId)).error).not.toBeNull();
    expect((await client.rpc("append_review_task", { p_company: f.company.id, p_run: f.run.runId, p_actor: f.who.userId, p_correlation: randomUUID(), p_event: f.raw() })).error).toEqual(client === admin ? null : expect.anything());
  }
  const cookie = await cookieFor(f.company.payment);
  expect((await call(POST, { cookie: cookie.cookie, body: f.create }, withId(f.run.runId))).status).toBe(403);
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", f.company.id).eq("user_id", f.who.userId)).error).toBeNull();
  expect((await f.rpc(event)).data?.code).toBe("FORBIDDEN");
});

it("rejects a missing-evidence task once valid configured evidence is present", async () => {
  const f = await fixture();
  expect((await admin.from("import_batches").insert({ company_id: f.company.id, run_id: f.run.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: f.who.userId })).error).toBeNull();
  expect((await f.rpc(f.raw())).data?.code).toBe("SOURCE_UNAVAILABLE");
});

it("returns committed retries after source/assignee changes but blocks new unavailable assignments", async () => {
  const f = await fixture();
  expect((await admin.from("memberships").update({ roles: ["HR_APPROVER"] }).eq("company_id", f.company.id).eq("user_id", f.company.payment.id)).error).toBeNull();
  const command = { ...f.create, assigneeId: f.company.payment.id };
  await reviewTaskAction(admin, f.who, f.run.runId, command);
  expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", f.company.id).eq("user_id", f.company.payment.id)).error).toBeNull();
  expect((await admin.from("import_batches").insert({ company_id: f.company.id, run_id: f.run.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "a".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: f.who.userId })).error).toBeNull();
  const retry = await reviewTaskAction(admin, f.who, f.run.runId, command);
  expect(retry.tasks).toHaveLength(1); expect(retry.tasks[0]).toMatchObject({ revision: 1, assigneeAvailable: false });
  await expect(reviewTaskAction(admin, f.who, f.run.runId, { ...command, taskId: randomUUID(), idempotencyKey: randomUUID() })).rejects.toThrow("Assignee");
  await expect(reviewTaskAction(admin, f.who, f.run.runId, { ...command, assigneeId: f.who.userId, taskId: randomUUID(), idempotencyKey: randomUUID() })).rejects.toThrow("Review source");
  expect((await admin.from("review_task_events").select("id").eq("run_id", f.run.runId)).data).toHaveLength(1);
});
