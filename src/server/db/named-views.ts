import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TransitionError } from "@/core/domain/machines";
import { isPayrollRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { CreateNamedViewSchema, NamedViewCommandSchema, NamedViewPayloadSchema, validateNamedView, type CreateNamedView, type NamedViewCommand, type NamedViewDetail, type NamedViewSummary } from "@/core/named-views";
import type { TableId } from "@/core/views";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { resourceColumnDef, resourceColumns } from "./resources";

interface Who { companyId: string; userId: string; roles: readonly Role[]; correlationId: string }
interface Head { id: string; company_id: string; table_id: TableId; scope: "PERSONAL" | "TEAM"; owner_id: string; revision: number; archived: boolean; created_at: string; updated_at: string }
interface Version { id: string; company_id: string; view_id: string; revision: number; action: "CREATE" | "UPDATE" | "ARCHIVE"; actor_id: string; created_at: string; payload_enc: string | null }
const headFields = "id,company_id,table_id,scope,owner_id,revision,archived,created_at,updated_at";
async function currentRoles(reader: SupabaseClient, who: Who): Promise<Role[]> {
  const result = await reader.from("memberships").select("roles").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("named view membership unavailable");
  if (!result.data?.roles?.length) throw new WorkflowError("FORBIDDEN", "Named view access changed");
  return result.data.roles as Role[];
}
function visible(head: Head, who: Who, table: TableId) {
  if (head.company_id !== who.companyId || head.table_id !== table || head.scope === "PERSONAL" && head.owner_id !== who.userId) throw new TransitionError("NOT_FOUND", "named view not found");
}
async function columns(reader: SupabaseClient, who: Who, roles: readonly Role[], table: TableId) {
  return table === "workers" ? (await resourceColumns(reader, who.companyId, roles)).map(resourceColumnDef) : [];
}
async function headFor(reader: SupabaseClient, who: Who, table: TableId, id: string) {
  const result = await reader.from("named_table_views").select(headFields).eq("company_id", who.companyId).eq("table_id", table).eq("id", id).maybeSingle();
  if (result.error) throw new Error("named view read unavailable");
  if (!result.data) throw new TransitionError("NOT_FOUND", "named view not found");
  const head = result.data as Head; visible(head, who, table); return head;
}
async function project(reader: SupabaseClient, who: Who, table: TableId, head: Head): Promise<NamedViewDetail> {
  visible(head, who, table);
  const result = await reader.from("named_table_view_versions").select("id,company_id,view_id,revision,action,actor_id,created_at,payload_enc", { count: "exact" }).eq("company_id", who.companyId).eq("view_id", head.id).order("revision", { ascending: false }).limit(100);
  const versions = must(result, "named view history") as Version[];
  if (result.count === null || versions.length !== Math.min(result.count, 100) || versions.some(v => v.company_id !== who.companyId || v.view_id !== head.id) || new Set(versions.map(v => v.revision)).size !== versions.length || versions[0]?.revision !== head.revision) throw new WorkflowError("CONFLICT", "Named view changed while loading; reload its current version");
  // Membership is checked after fetching ciphertext and again before returning it.
  const roles = await currentRoles(reader, who);
  const canEdit = head.scope === "PERSONAL" ? head.owner_id === who.userId : isPayrollRole(roles);
  const detail: NamedViewDetail = { id: head.id, scope: head.scope, ownerId: head.owner_id, revision: head.revision, archived: head.archived, createdAt: head.created_at, updatedAt: head.updated_at, name: null, view: null, available: false, canEdit, unavailableReason: head.archived ? "This view is archived." : "This view is unavailable for your current role or table fields.", history: versions.map(v => ({ id: v.id, revision: v.revision, action: v.action, actorId: v.actor_id, createdAt: v.created_at })), hasMoreHistory: result.count > 100 };
  if (!head.archived) {
    const custom = await columns(reader, who, roles, table);
    const payload = NamedViewPayloadSchema.parse(await openJson(who.companyId, "named_table_view_versions", "payload_enc", versions[0].id, versions[0].payload_enc!));
    try { validateNamedView(payload.view, table, roles, custom); detail.name = payload.name; detail.view = payload.view; detail.available = true; detail.unavailableReason = null; } catch { /* incompatible definitions remain entirely redacted */ }
  }
  const latestRoles = await currentRoles(reader, who);
  if (JSON.stringify([...latestRoles].sort()) !== JSON.stringify([...roles].sort())) throw new WorkflowError("FORBIDDEN", "Named view access changed");
  return detail;
}
export async function loadNamedView(reader: SupabaseClient, who: Who, table: TableId, id: string) {
  await currentRoles(reader, who); return project(reader, who, table, await headFor(reader, who, table, id));
}
export async function listNamedViews(reader: SupabaseClient, who: Who, table: TableId) {
  const roles = await currentRoles(reader, who);
  const result = await reader.from("named_table_views").select(headFields, { count: "exact" }).eq("company_id", who.companyId).eq("table_id", table).or(`scope.eq.TEAM,owner_id.eq.${who.userId}`).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(100);
  const heads = must(result, "named view inventory") as Head[];
  if (result.count === null || heads.length !== Math.min(result.count, 100)) throw new Error("named view inventory incomplete");
  const views: NamedViewSummary[] = [];
  for (const head of heads) {
    const detail = await project(reader, who, table, head);
    views.push({ id: detail.id, scope: detail.scope, ownerId: detail.ownerId, revision: detail.revision, archived: detail.archived, createdAt: detail.createdAt, updatedAt: detail.updatedAt, name: detail.name, available: detail.available, canEdit: detail.canEdit, unavailableReason: detail.unavailableReason });
  }
  const latestRoles = await currentRoles(reader, who);
  if (JSON.stringify([...latestRoles].sort()) !== JSON.stringify([...roles].sort())) throw new WorkflowError("FORBIDDEN", "Named view access changed");
  return { views, hasMore: result.count > 100, canCreateTeam: isPayrollRole(roles) };
}
async function append(reader: SupabaseClient, who: Who, table: TableId, id: string | null, command: CreateNamedView | NamedViewCommand) {
  const roles = await currentRoles(reader, who), head = id ? await headFor(reader, who, table, id) : null;
  const scope = command.action === "create" ? command.scope : head!.scope;
  if (scope === "TEAM" && !isPayrollRole(roles)) throw new WorkflowError("FORBIDDEN", "Only current HR or payroll members may change team views");
  if (command.action !== "archive") validateNamedView(command.view, table, roles, await columns(reader, who, roles, table));
  const versionId = randomUUID(), viewId = id ?? randomUUID();
  const commandHash = await fingerprint(who.companyId, { table, id, actorId: who.userId, command });
  const payload = command.action === "archive" ? null : await sealJson(who.companyId, "named_table_view_versions", "payload_enc", versionId, { name: command.name, view: command.view });
  const result = must(await db().rpc("append_named_table_view", { p_company: who.companyId, p_table: table, p_actor: who.userId, p_correlation: who.correlationId, p_view: viewId, p_version: versionId, p_scope: scope, p_action: command.action.toUpperCase(), p_expected_revision: command.action === "create" ? 0 : command.expectedRevision, p_idempotency_key: command.idempotencyKey, p_command_hash: commandHash, p_payload_enc: payload }), "named view append") as { code: string; id?: string; revision?: number };
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Named view access changed");
  if (result.code === "NOT_FOUND") throw new TransitionError("NOT_FOUND", "named view not found");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Named view changed or retry key was reused; reload before continuing");
  return { id: result.id!, revision: result.revision! };
}
export const createNamedView = (reader: SupabaseClient, who: Who, table: TableId, raw: CreateNamedView) => append(reader, who, table, null, CreateNamedViewSchema.parse(raw));
export const namedViewAction = (reader: SupabaseClient, who: Who, table: TableId, id: string, raw: NamedViewCommand) => append(reader, who, table, id, NamedViewCommandSchema.parse(raw));
