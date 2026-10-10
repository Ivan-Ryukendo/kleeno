import { expect, it } from "vitest";
import { ReviewTaskCommandSchema, projectReviewTasks } from "@/core/workflow/review-tasks";

const id = "10000000-0000-4000-8000-000000000001";
const command = { action: "create", taskId: id, expectedRevision: 0, idempotencyKey: id, source: { kind: "MISSING_EVIDENCE", importType: "TIMESHEETS" }, assigneeId: id, dueAt: "2026-10-08T12:00:00+06:00", severity: "HIGH", status: "OPEN", nextAction: "Request approved timesheet evidence", evidenceRefs: ["owner-supplied-reference"] };

it("accepts explicit ownership while rejecting ambiguous, empty and oversized commands", () => {
  expect(ReviewTaskCommandSchema.parse(command)).toMatchObject(command);
  for (const changed of [{ dueAt: "2026-10-08T12:00:00" }, { nextAction: " " }, { nextAction: "x".repeat(2001) }, { severity: "CRITICAL" }, { assigneeId: "foreign email" }, { evidenceRefs: ["same", "same"] }, { status: "RESOLVED" }, { extra: "ignored" }, { expectedRevision: 1 }]) {
    expect(ReviewTaskCommandSchema.safeParse({ ...command, ...changed }).success).toBe(false);
  }
  const update = Object.fromEntries(Object.entries(command).filter(([key]) => key !== "source"));
  expect(ReviewTaskCommandSchema.safeParse({ ...update, action: "update", expectedRevision: 1, status: "RESOLVED" }).success).toBe(true);
  expect(ReviewTaskCommandSchema.safeParse({ ...command, action: "update", expectedRevision: 1 }).success).toBe(false);
});

it("keeps immutable ownership history and exposes unavailable revoked assignees", () => {
  const initial = { id, taskId: id, revision: 1, actorId: id, at: "2026-10-07T12:00:00Z", source: command.source as { kind: "MISSING_EVIDENCE"; importType: "TIMESHEETS" }, assigneeId: id, dueAt: command.dueAt, severity: "HIGH" as const, status: "OPEN" as const, nextAction: "Ask for evidence", evidenceRefs: [] };
  const latest = { ...initial, id: "20000000-0000-4000-8000-000000000002", revision: 2, status: "IN_PROGRESS" as const, nextAction: "Check evidence" };
  const tasks = projectReviewTasks([latest, initial], []);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ revision: 2, status: "IN_PROGRESS", assigneeAvailable: false });
  expect(tasks[0].history.map(e => e.nextAction)).toEqual(["Ask for evidence", "Check evidence"]);
  expect(projectReviewTasks([initial, latest], [id])[0].assigneeAvailable).toBe(true);
  expect(() => projectReviewTasks([initial, { ...latest, revision: 3 }], [id])).toThrow("incomplete");
});
