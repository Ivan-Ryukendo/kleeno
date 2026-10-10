import { z } from "zod";

export const ReviewTaskSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXCEPTION"), exceptionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("MISSING_EVIDENCE"), importType: z.enum(["TIMESHEETS", "LEAVE", "ACTUAL_PAID"]) }).strict(),
]);
export type ReviewTaskSource = z.infer<typeof ReviewTaskSourceSchema>;
const fields = {
  taskId: z.string().uuid(), idempotencyKey: z.string().uuid(), assigneeId: z.string().uuid(),
  dueAt: z.iso.datetime({ offset: true }), severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  nextAction: z.string().trim().min(1).max(2000),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(20).refine(refs => new Set(refs).size === refs.length, "duplicate evidence reference"),
};
export const ReviewTaskCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...fields, action: z.literal("create"), expectedRevision: z.literal(0), status: z.literal("OPEN"), source: ReviewTaskSourceSchema }).strict(),
  z.object({ ...fields, action: z.literal("update"), expectedRevision: z.number().int().min(1), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]) }).strict(),
]);
export type ReviewTaskCommand = z.infer<typeof ReviewTaskCommandSchema>;
export interface ReviewTaskEvent {
  id: string; taskId: string; revision: number; actorId: string; at: string; source: ReviewTaskSource;
  assigneeId: string; dueAt: string; severity: "LOW" | "MEDIUM" | "HIGH"; status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  nextAction: string; evidenceRefs: string[];
}
export interface ReviewTask extends ReviewTaskEvent { history: ReviewTaskEvent[]; assigneeAvailable: boolean }

/** Pure immutable projection; task resolution never resolves its source exception or grants authority. */
export function projectReviewTasks(events: readonly ReviewTaskEvent[], eligibleAssignees: readonly string[]): ReviewTask[] {
  const groups = new Map<string, ReviewTaskEvent[]>();
  for (const event of events) {
    const history = groups.get(event.taskId) ?? [];
    history.push(event); groups.set(event.taskId, history);
  }
  return [...groups.values()].map(history => {
    history.sort((a, b) => a.revision - b.revision);
    if (history.some((event, index) => event.revision !== index + 1 || JSON.stringify(event.source) !== JSON.stringify(history[0].source))) throw new Error("review task history incomplete or source changed");
    const latest = history[history.length - 1];
    return { ...latest, history, assigneeAvailable: eligibleAssignees.includes(latest.assigneeId) };
  }).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.taskId.localeCompare(b.taskId));
}
