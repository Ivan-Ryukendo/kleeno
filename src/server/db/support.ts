import "server-only";
import { randomUUID } from "node:crypto";
import { CreateSupportSchema, SupportAdminCommandSchema, SupportUserCommandSchema, SupportRequestIdSchema, type CreateSupport, type SupportAdminCommand, type SupportUserCommand, type SupportThread, type SupportTicketMeta, type SupportMessage } from "@/core/support";
import { TransitionError } from "@/core/domain/machines";
import { WorkflowError } from "@/core/workflow";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { isPlatformAdmin } from "./growth";

interface Requester { companyId: string; userId: string; correlationId?: string }
interface Staff { userId: string; correlationId?: string }
type TicketRow = { id: string; company_id: string; requester_id: string; category: SupportTicketMeta["category"]; severity: SupportTicketMeta["severity"]; status: SupportTicketMeta["status"]; assignee_id: string | null; revision: number; created_at: string; updated_at: string };
type EventRow = { id: string; action: SupportMessage["action"]; visibility: SupportMessage["visibility"]; actor_id: string; revision: number; created_at: string; payload_enc: string | null; status: SupportTicketMeta["status"]; severity: SupportTicketMeta["severity"]; assignee_id: string | null };
const columns = "id,company_id,requester_id,category,severity,status,assignee_id,revision,created_at,updated_at";
const metadata = (row: TicketRow): SupportTicketMeta => ({ id: row.id, companyId: row.company_id, requesterId: row.requester_id, category: row.category, severity: row.severity, status: row.status, assigneeId: row.assignee_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
async function assertMember(who: Requester) {
  const result = await db().from("memberships").select("user_id").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("support membership unavailable");
  if (!result.data) throw new WorkflowError("FORBIDDEN", "Current company membership is required");
}
async function assertAdmin(who: Staff) {
  if (!await isPlatformAdmin(who.userId)) throw new WorkflowError("FORBIDDEN", "Current platform support access is required");
}
async function readTicket(id: string, who?: Requester): Promise<TicketRow> {
  SupportRequestIdSchema.parse(id);
  let query = db().from("support_requests").select(columns).eq("id", id);
  if (who) query = query.eq("company_id", who.companyId).eq("requester_id", who.userId);
  const result = await query.maybeSingle();
  if (result.error) throw new Error("support request unavailable");
  if (!result.data) throw new TransitionError("NOT_FOUND", "Support request not found");
  return result.data as TicketRow;
}
export async function listSupport(who: Requester) {
  await assertMember(who);
  const rows = must(await db().from("support_requests").select(columns).eq("company_id", who.companyId).eq("requester_id", who.userId).order("updated_at", { ascending: false }).order("id").limit(101), "support list") as TicketRow[];
  return { tickets: rows.slice(0, 100).map(metadata), hasMore: rows.length > 100 };
}
export async function listAdminSupport(who: Staff) {
  await assertAdmin(who);
  const rows = must(await db().from("support_requests").select(columns).order("updated_at", { ascending: false }).order("id").limit(101), "support queue") as TicketRow[];
  return { tickets: rows.slice(0, 100).map(metadata), hasMore: rows.length > 100 };
}
async function thread(row: TicketRow, internal: boolean, recheckAccess: () => Promise<void>): Promise<SupportThread> {
  let query = db().from("support_events").select("id,action,visibility,actor_id,revision,created_at,payload_enc,status,severity,assignee_id", { count: "exact" }).eq("company_id", row.company_id).eq("request_id", row.id);
  if (!internal) query = query.eq("visibility", "CUSTOMER");
  const result = await query.order("revision").limit(1000);
  const rows = must(result, "support history") as EventRow[];
  // ponytail: refuse a capped incomplete thread; add paginated history when threads exceed the reader's 1000-row cap.
  if (result.count === null || result.count !== rows.length) throw new WorkflowError("CONFLICT", "Support history is incomplete; contact the platform administrator");
  await recheckAccess(); // recheck after the history read and before opening submitted confidential content
  let subject: string | null = null;
  const messages: SupportMessage[] = [];
  for (const event of rows) {
    const payload = event.payload_enc ? await openJson<{ subject?: string; body: string; evidenceRefs: string[] }>(row.company_id, "support_events", "payload_enc", event.id, event.payload_enc) : null;
    if (event.action === "CREATE") subject = payload?.subject ?? null;
    messages.push({ id: event.id, action: event.action, visibility: event.visibility, actorId: event.actor_id, revision: event.revision, createdAt: event.created_at, body: payload?.body ?? null, evidenceRefs: payload?.evidenceRefs ?? [], status: event.status, severity: event.severity, assigneeId: event.assignee_id });
  }
  if (subject === null) throw new Error("support request evidence is incomplete");
  return { ticket: { ...metadata(row), subject }, messages };
}
export async function loadSupport(who: Requester, id: string) {
  await assertMember(who); const row = await readTicket(id, who);
  return thread(row, false, () => assertMember(who));
}
export async function loadAdminSupport(who: Staff, id: string) {
  await assertAdmin(who); const row = await readTicket(id);
  return thread(row, true, () => assertAdmin(who));
}
async function append(who: Requester | Staff, companyId: string, id: string, input: CreateSupport | SupportUserCommand | SupportAdminCommand, admin: boolean, create = false) {
  const eventId = randomUUID();
  const payload = "body" in input ? { body: input.body, evidenceRefs: input.evidenceRefs, ...("subject" in input ? { subject: input.subject } : {}) } : null;
  const commandHash = await fingerprint(companyId, { requestId: create ? null : id, actorId: who.userId, admin, input });
  const result = must(await db().rpc("append_support_event", { p_company: companyId, p_request: id, p_actor: who.userId, p_admin: admin, p_correlation: who.correlationId ?? randomUUID(), p_command: {
    id: eventId, action: create ? "CREATE" : (input as SupportUserCommand | SupportAdminCommand).action.toUpperCase(), expected_revision: "expectedRevision" in input ? input.expectedRevision : 0,
    idempotency_key: input.idempotencyKey, command_hash: commandHash, payload_enc: payload ? await sealJson(companyId, "support_events", "payload_enc", eventId, payload) : null,
    ...("category" in input ? { category: input.category, severity: input.severity } : {}),
    ...("assigneeId" in input ? { status: input.status, severity: input.severity, assignee_id: input.assigneeId } : {}),
  } }), "support append") as { code: string; id?: string; revision?: number };
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "Support request not found");
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current access cannot change this support request");
  if (result.code !== "OK" || !result.id || !result.revision) throw new WorkflowError("CONFLICT", "Support request changed or the command key was already used; refresh before continuing");
  return { id: result.id, revision: result.revision };
}
export async function createSupport(who: Requester, input: CreateSupport) {
  const command = CreateSupportSchema.parse(input); await assertMember(who);
  const result = await append(who, who.companyId, randomUUID(), command, false, true);
  return { id: result.id };
}
export async function supportAction(who: Requester, id: string, input: SupportUserCommand) {
  const command = SupportUserCommandSchema.parse(input); await assertMember(who); await readTicket(id, who);
  return append(who, who.companyId, id, command, false);
}
export async function adminSupportAction(who: Staff, id: string, input: SupportAdminCommand) {
  const command = SupportAdminCommandSchema.parse(input); await assertAdmin(who); const row = await readTicket(id);
  if (command.action === "triage" && command.assigneeId && !await isPlatformAdmin(command.assigneeId)) throw new WorkflowError("FORBIDDEN", "Assignee must be a current platform support administrator");
  return append(who, row.company_id, id, command, true);
}
