import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type Role } from "@/core/tenancy";
import { ViewError, type ColumnDef } from "@/core/views";
import { evaluateResource, ResourceDefinitionSchema, ResourceInputSchema, resourceFormula, type ResourceDefinition } from "@/core/views/resources";
import { TransitionError } from "@/core/domain/machines";
import { openJson, sealJson } from "@/server/crypto";
import { loadConfig } from "./configs";
import { db, must } from "./client";

const HR: readonly Role[] = ["HR_APPROVER", "PAYROLL_APPROVER"];
interface Who { companyId: string; userId: string; roles: readonly Role[]; correlationId: string }
export interface ResourceColumn { id: string; columnKey: string; definition: ResourceDefinition }

export async function resourceColumns(reader: SupabaseClient, companyId: string, roles: readonly Role[]): Promise<ResourceColumn[]> {
  if (!hasRole(roles, ...HR)) return [];
  const rows = must(await reader.from("resource_columns").select("id,column_key,definition_enc").eq("company_id", companyId).order("created_at").limit(30), "resource columns");
  return Promise.all(rows.map(async (r) => ({ id: r.id, columnKey: r.column_key, definition: ResourceDefinitionSchema.parse((await openJson<{ definition: unknown }>(companyId, "resource_columns", "definition_enc", r.id, r.definition_enc)).definition) })));
}

export function resourceColumnDef(c: ResourceColumn): ColumnDef {
  const r = c.definition.rule;
  return { id: c.columnKey, label: c.definition.label, type: r.kind === "INPUT" ? r.type : "number", roles: HR, resource: true, formula: resourceFormula(c.definition) };
}

/** HR confirms a supported definition backed by an approved configuration, never arbitrary executable formula text. */
export async function createResourceColumn(who: Who, raw: ResourceDefinition, reason: string) {
  if (!hasRole(who.roles, ...HR)) throw new ViewError("HR review required");
  const definition = ResourceDefinitionSchema.parse(raw);
  if (!reason.trim() || reason.length > 500) throw new ViewError("a review reason is required");
  if (definition.policy) {
    const config = await loadConfig(who.companyId, definition.policy.configVersion);
    if (!config || !["APPROVED", "ACTIVE", "SUPERSEDED"].includes(config.status) || !definition.policy.clauseIds.every((id) => config.clauses.some((c) => c.id === id))) throw new ViewError("approved policy evidence required");
  }
  const { count, error } = await db().from("resource_columns").select("id", { count: "exact", head: true }).eq("company_id", who.companyId);
  if (error) throw new Error("db resource count failed");
  if ((count ?? 0) >= 24) throw new ViewError("maximum 24 custom columns");
  const id = randomUUID();
  const columnKey = `r_${id.replaceAll("-", "").slice(0, 24)}`;
  const definition_enc = await sealJson(who.companyId, "resource_columns", "definition_enc", id, { definition, reviewReason: reason.trim() });
  must(await db().from("resource_columns").insert({ id, company_id: who.companyId, column_key: columnKey, definition_enc, policy_config_version: definition.policy?.configVersion ?? null, created_by: who.userId, correlation_id: who.correlationId }).select("id"), "resource definition");
  return { id, columnKey };
}

export async function resourceInput(reader: SupabaseClient, companyId: string, columnId: string, workerId: string) {
  const worker = await reader.from("workers").select("id").eq("company_id", companyId).eq("id", workerId).maybeSingle();
  if (worker.error) throw new Error("db resource worker failed");
  if (!worker.data) throw new ViewError("worker not found");
  const row = (await reader.from("resource_inputs").select("id,version,input_enc").eq("company_id", companyId).eq("column_id", columnId).eq("worker_id", workerId).order("version", { ascending: false }).limit(1).maybeSingle());
  if (row.error) throw new Error("db resource input failed");
  return row.data ? { input: await openJson(companyId, "resource_inputs", "input_enc", row.data.id, row.data.input_enc), version: row.data.version as number } : { input: null, version: null };
}

/** New immutable evidence revision; unique version rejects concurrent/stale edits. These inputs never feed payroll amounts. */
export async function saveResourceInput(who: Who, columnId: string, workerId: string, raw: unknown, expectedVersion: number | null) {
  if (!hasRole(who.roles, ...HR)) throw new ViewError("HR review required");
  const columns = await resourceColumns(db(), who.companyId, who.roles);
  const column = columns.find((c) => c.id === columnId);
  if (!column) throw new ViewError("resource column not found");
  const input = ResourceInputSchema.parse(raw);
  if (evaluateResource(column.definition, input).status !== "VERIFIED") throw new ViewError("source inputs do not satisfy this column's rules");
  const current = await resourceInput(db(), who.companyId, columnId, workerId);
  if (current.version !== expectedVersion) throw new TransitionError("STALE_STATE", "the input changed; review the latest version");
  const id = randomUUID();
  const version = (current.version ?? 0) + 1;
  const input_enc = await sealJson(who.companyId, "resource_inputs", "input_enc", id, input);
  must(await db().from("resource_inputs").insert({ id, company_id: who.companyId, column_id: columnId, worker_id: workerId, version, input_enc, created_by: who.userId, correlation_id: who.correlationId }).select("id"), "resource input review");
  return { id, version };
}

export async function latestResourceInputs(reader: SupabaseClient, companyId: string, columnIds: string[], workerIds: string[]) {
  const latest = new Map<string, { input: unknown; id: string; version: number; createdAt: string }>();
  if (!columnIds.length || !workerIds.length) return latest;
  const rows = must(await reader.rpc("latest_resource_inputs", { p_company: companyId, p_columns: columnIds, p_workers: workerIds }), "resource evidence") as { id: string; column_id: string; worker_id: string; version: number; created_at: string; input_enc: string }[];
  for (const r of rows) {
    const key = `${r.column_id}:${r.worker_id}`;
    if (!latest.has(key)) latest.set(key, { input: await openJson(companyId, "resource_inputs", "input_enc", r.id, r.input_enc), id: r.id, version: r.version, createdAt: r.created_at });
  }
  return latest;
}
