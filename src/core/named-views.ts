import { z } from "zod";
import { hasRole, type Role } from "./tenancy";
import { validateView, ViewError, ViewSchema, type ColumnDef, type TableId, type ViewDef } from "./views";

const name = z.string().trim().min(1).max(80);
const commandKey = z.string().uuid();
export const CreateNamedViewSchema = z.object({ action: z.literal("create"), scope: z.enum(["PERSONAL", "TEAM"]), name, view: ViewSchema, idempotencyKey: commandKey }).strict();
export const NamedViewCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), expectedRevision: z.number().int().min(1).max(2147483646), idempotencyKey: commandKey, name, view: ViewSchema }).strict(),
  z.object({ action: z.literal("archive"), expectedRevision: z.number().int().min(1).max(2147483646), idempotencyKey: commandKey }).strict(),
]);
export const NamedViewPayloadSchema = z.object({ name, view: ViewSchema }).strict();
export type CreateNamedView = z.infer<typeof CreateNamedViewSchema>;
export type NamedViewCommand = z.infer<typeof NamedViewCommandSchema>;
export interface NamedViewSummary {
  id: string; scope: "PERSONAL" | "TEAM"; ownerId: string; revision: number; archived: boolean;
  createdAt: string; updatedAt: string; name: string | null; available: boolean; canEdit: boolean; unavailableReason: string | null;
}
export interface NamedViewDetail extends NamedViewSummary {
  view: ViewDef | null; history: { id: string; revision: number; action: "CREATE" | "UPDATE" | "ARCHIVE"; actorId: string; createdAt: string }[]; hasMoreHistory: boolean;
}
export function validateNamedView(raw: ViewDef, table: TableId, roles: readonly Role[], custom: readonly ColumnDef[] = []): ViewDef {
  const view = ViewSchema.parse(raw);
  if (view.table !== table) throw new ViewError("saved view table mismatch");
  if (table === "lines" && !hasRole(roles, "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER")) throw new ViewError("pay lines unavailable");
  return validateView(view, roles, custom);
}
