import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TransitionError } from "@/core/domain/machines";
import { isPayrollRole, type Role } from "@/core/tenancy";
import { WorkflowError, type Ctx } from "@/core/workflow";
import { ReviewTaskCommandSchema, projectReviewTasks, type ReviewTaskCommand, type ReviewTaskEvent, type ReviewTaskSource } from "@/core/workflow/review-tasks";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { reviewReadiness } from "./review-readiness";

type EventRow = { id: string; task_id: string; revision: number; actor_id: string; assignee_id: string; due_at: string; severity: ReviewTaskEvent["severity"]; status: ReviewTaskEvent["status"]; source_kind: ReviewTaskSource["kind"]; exception_id: string | null; import_type: "TIMESHEETS" | "LEAVE" | "ACTUAL_PAID" | null; created_at: string; payload_enc: string };

async function authorize(reader: SupabaseClient, who: Ctx, runId: string) {
  if (!isPayrollRole(who.roles)) throw new WorkflowError("FORBIDDEN", "Only HR or payroll reviewers may access owned review work");
  const membership = await reader.from("memberships").select("roles,removed_at").eq("company_id", who.companyId).eq("user_id", who.userId).maybeSingle();
  if (membership.error) throw new Error("review task membership unavailable");
  if (!membership.data || membership.data.removed_at !== null || !isPayrollRole(membership.data.roles as Role[])) throw new WorkflowError("FORBIDDEN", "Current membership cannot access review work");
  const run = await reader.from("payroll_runs").select("id").eq("company_id", who.companyId).eq("id", runId).maybeSingle();
  if (run.error) throw new Error("review task run unavailable");
  if (!run.data) throw new TransitionError("NOT_FOUND", "run not found");
}

/** IDs/roles only: eligible ownership options never require employee names or email addresses. */
export async function loadReviewTasks(reader: SupabaseClient, who: Ctx, runId: string) {
  await authorize(reader, who, runId);
  const memberResult = await reader.from("memberships").select("user_id,roles", { count: "exact" }).eq("company_id", who.companyId).is("removed_at", null);
  const members = must(memberResult, "review task assignees") as { user_id: string; roles: Role[] }[];
  if (memberResult.count !== members.length) throw new Error("review task assignee list incomplete; no partial ownership options returned");
  const assignees = members.filter(member => isPayrollRole(member.roles)).map(member => ({ id: member.user_id, roles: member.roles }));
  const events: ReviewTaskEvent[] = [];
  let eventCount: number | null = null;
  // ponytail: bounded 10,000-event run history; add explicit cursor pagination if real workloads exceed it.
  for (let offset = 0; ; offset += 500) {
    if (offset >= 10000) throw new Error("review task history exceeds bounded view; no partial history returned");
    const result = await reader.from("review_task_events").select("*", { count: "exact" }).eq("company_id", who.companyId).eq("run_id", runId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 499);
    const rows = must(result, "review task history") as EventRow[];
    if (result.count === null || eventCount !== null && result.count !== eventCount) throw new WorkflowError("CONFLICT", "Review work changed while loading; refresh the queue");
    eventCount = result.count;
    for (const row of rows) {
      const detail = await openJson<{ nextAction: string; evidenceRefs: string[] }>(who.companyId, "review_task_events", "payload_enc", row.id, row.payload_enc);
      const source: ReviewTaskSource = row.source_kind === "EXCEPTION" ? { kind: "EXCEPTION", exceptionId: row.exception_id! } : { kind: "MISSING_EVIDENCE", importType: row.import_type! };
      events.push({ id: row.id, taskId: row.task_id, revision: row.revision, actorId: row.actor_id, assigneeId: row.assignee_id, dueAt: row.due_at, severity: row.severity, status: row.status, source, at: row.created_at, ...detail });
    }
    if (events.length === eventCount) break;
    if (rows.length < 500) throw new Error("review task history incomplete; no partial history returned");
  }
  const readiness = await reviewReadiness(reader, who.companyId, runId);
  const exceptionResult = await reader.from("exceptions").select("id", { count: "exact" }).eq("company_id", who.companyId).eq("run_id", runId).in("status", ["OPEN", "IN_REVIEW", "ESCALATED"]);
  const exceptions = must(exceptionResult, "review task sources") as { id: string }[];
  if (exceptionResult.count !== exceptions.length) throw new Error("review task source list incomplete; no partial sources returned");
  const sources: ReviewTaskSource[] = [...exceptions.map(exception => ({ kind: "EXCEPTION" as const, exceptionId: exception.id })), ...readiness.readiness.items.filter(item => item.status !== "RECEIVED").map(item => ({ kind: "MISSING_EVIDENCE" as const, importType: item.id as "TIMESHEETS" | "LEAVE" | "ACTUAL_PAID" }))];
  return { tasks: projectReviewTasks(events, assignees.map(member => member.id)), assignees, sources };
}

export async function reviewTaskAction(reader: SupabaseClient, who: Ctx, runId: string, raw: ReviewTaskCommand) {
  const command = ReviewTaskCommandSchema.parse(raw);
  await authorize(reader, who, runId);
  const id = command.action === "create" ? command.taskId : randomUUID();
  const commandHash = await fingerprint(who.companyId, { runId, actorId: who.userId, command });
  const payload = await sealJson(who.companyId, "review_task_events", "payload_enc", id, { nextAction: command.nextAction, evidenceRefs: command.evidenceRefs });
  const result = must(await db().rpc("append_review_task", {
    p_company: who.companyId, p_run: runId, p_actor: who.userId, p_correlation: who.correlationId,
    p_event: { id, task_id: command.taskId, action: command.action, expected_revision: command.expectedRevision, idempotency_key: command.idempotencyKey, command_hash: commandHash, assignee_id: command.assigneeId, due_at: command.dueAt, severity: command.severity, status: command.status, payload_enc: payload,
      ...(command.action === "create" ? { source_kind: command.source.kind, ...(command.source.kind === "EXCEPTION" ? { exception_id: command.source.exceptionId } : { import_type: command.source.importType }) } : {}) },
  }), "review task append") as { code: string; id?: string };
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "run not found");
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current membership cannot change review work");
  if (result.code === "ASSIGNEE_UNAVAILABLE") throw new WorkflowError("CONFLICT", "Assignee no longer has reviewer access; choose a current reviewer");
  if (result.code === "SOURCE_UNAVAILABLE") throw new WorkflowError("CONFLICT", "Review source is no longer missing or open; reload before creating work");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Review task changed or retry key was reused; reload before continuing");
  return loadReviewTasks(reader, who, runId);
}
