import { z } from "zod";

export const SUPPORT_CATEGORIES = ["ACCOUNT", "IMPORT", "REVIEW", "OTHER"] as const;
export const SUPPORT_SEVERITIES = ["NORMAL", "URGENT"] as const;
export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"] as const;
const content = { body: z.string().trim().min(1).max(2000), evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(10).default([]) };
const command = { idempotencyKey: z.string().uuid(), expectedRevision: z.number().int().min(1).max(2147483646) };
export const SupportRequestIdSchema = z.string().uuid();
export const CreateSupportSchema = z.object({ idempotencyKey: z.string().uuid(), category: z.enum(SUPPORT_CATEGORIES), severity: z.enum(SUPPORT_SEVERITIES), subject: z.string().trim().min(1).max(160), ...content }).strict();
export const SupportUserCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...command, action: z.literal("reply"), ...content }).strict(),
  z.object({ ...command, action: z.literal("close") }).strict(),
]);
export const SupportAdminCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...command, action: z.literal("reply"), ...content }).strict(),
  z.object({ ...command, action: z.literal("note"), ...content }).strict(),
  z.object({ ...command, action: z.literal("triage"), status: z.enum(SUPPORT_STATUSES), severity: z.enum(SUPPORT_SEVERITIES), assigneeId: z.string().uuid().nullable() }).strict(),
]);
export type CreateSupport = z.infer<typeof CreateSupportSchema>;
export type SupportUserCommand = z.infer<typeof SupportUserCommandSchema>;
export type SupportAdminCommand = z.infer<typeof SupportAdminCommandSchema>;
export interface SupportTicketMeta {
  id: string; companyId: string; requesterId: string;
  category: typeof SUPPORT_CATEGORIES[number]; severity: typeof SUPPORT_SEVERITIES[number]; status: typeof SUPPORT_STATUSES[number];
  assigneeId: string | null; revision: number; createdAt: string; updatedAt: string;
}
export interface SupportMessage {
  id: string; action: "CREATE" | "REPLY" | "NOTE" | "TRIAGE" | "CLOSE"; visibility: "CUSTOMER" | "INTERNAL";
  actorId: string; revision: number; createdAt: string; body: string | null; evidenceRefs: string[];
  status: SupportTicketMeta["status"]; severity: SupportTicketMeta["severity"]; assigneeId: string | null;
}
export interface SupportThread { ticket: SupportTicketMeta & { subject: string }; messages: SupportMessage[] }
