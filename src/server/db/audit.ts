import "server-only";
import type { AuditEvent } from "@/core/audit";
import { db, must } from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEYS = new Set(["runId", "run_id", "calculationId", "batchId", "obligationId", "attemptId", "approvalId", "executionId", "workerId"]);
const HASH_KEYS = new Set(["calculationHash", "calculation_hash", "planHash", "plan_hash", "txHash", "tx_hash", "guardRunKey"]);
const COUNT_KEYS = new Set(["rows", "accepted", "rejected", "newRecords", "raised", "count", "held", "obligations", "signals", "problems", "retries", "version", "configVersion"]);
const ENUM_KEYS = new Set(["from", "to", "status", "mode", "reason", "category", "action", "authorization", "type", "payType"]);
/** Audit payloads are not a generic object viewer: disclose only structured, non-financial references. */
export function safeAuditRefs(refs: unknown): Record<string, string | number> {
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return {};
  return Object.fromEntries(Object.entries(refs).filter(([key, value]) =>
    (ID_KEYS.has(key) && typeof value === "string" && UUID.test(value)) ||
    (HASH_KEYS.has(key) && typeof value === "string" && /^(0x)?[a-f0-9]{64}$/i.test(value)) ||
    (COUNT_KEYS.has(key) && typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (ENUM_KEYS.has(key) && typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)),
  ));
}

export interface AuditItem {
  id: string; event: string; entityType: string; entityId: string | null; actor: string; actorType: string; correlationId: string | null; at: string; refs: Record<string, string | number>; href: string | null;
}

/** Keyset-paginated, tenant-scoped timeline. Linked run entities are bounded and explicitly reported when truncated. */
export async function auditView(client: SupabaseClient, companyId: string, opts: { runId?: string; before?: string; entityType?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 50);
  let ids: string[] = [];
  let graphTruncated = false;
  if (opts.runId) {
    if (!UUID.test(opts.runId)) return { items: [] as AuditItem[], next: null, graphTruncated: false };
    const runRead = await client.from("payroll_runs").select("id, config_version").eq("company_id", companyId).eq("id", opts.runId).maybeSingle();
    if (runRead.error) throw new Error("audit run read failed");
    const run = runRead.data;
    if (!run) return { items: [] as AuditItem[], next: null, graphTruncated: false };
    const relations = await Promise.all(["import_batches", "calculations", "payroll_approvals", "exceptions", "obligation_metadata", "payment_batch_metadata"].map((table) => {
      const query = table === "exceptions" ? client.from("exceptions").select("id, ai_execution_id") : client.from(table).select("id");
      return query.eq("company_id", companyId).eq("run_id", opts.runId!).limit(501);
    }));
    ids = [opts.runId, ...relations.flatMap((r) => must(r, "audit run references").slice(0, 500).map((row) => row.id as string))];
    graphTruncated = relations.some((r) => r.data!.length > 500);
    const config = must(await client.from("payroll_configurations").select("id, ai_execution_id").eq("company_id", companyId).eq("version", run.config_version).limit(1), "audit configuration");
    ids.push(...config.map((c) => c.id as string), ...config.map((c) => c.ai_execution_id).filter(Boolean), ...relations.flatMap((r) => (r.data ?? []).map((row) => (row as unknown as { ai_execution_id?: string }).ai_execution_id).filter((id): id is string => !!id)));
  }
  ids = [...new Set(ids)];
  graphTruncated ||= ids.length > 160;
  ids = ids.slice(0, 160); // bounded query URL; company timeline retains every event beyond this linked-view limit
  let query = client.from("audit_events").select("id, event, entity_type, entity_id, actor, actor_type, correlation_id, refs, created_at").eq("company_id", companyId);
  const filters: string[] = [];
  if (opts.runId) filters.push(`or(entity_id.in.(${ids.join(",")}),refs->>runId.eq.${opts.runId},refs->>run_id.eq.${opts.runId})`);
  if (opts.before) {
    const [at, id] = opts.before.split("~");
    if (!Number.isFinite(Date.parse(at)) || !UUID.test(id ?? "")) throw new Error("invalid audit cursor");
    filters.push(`or(created_at.lt.${at},and(created_at.eq.${at},id.lt.${id}))`);
  }
  if (filters.length) query = query.or(`and(${filters.join(",")})`);
  if (opts.entityType) query = query.eq("entity_type", opts.entityType);
  const rows = must(await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1), "audit timeline");
  const items: AuditItem[] = rows.slice(0, limit).map((r) => {
    const refs = safeAuditRefs(r.refs);
    const runId = opts.runId ?? (typeof refs.runId === "string" ? refs.runId : ["run", "payroll_run", "payroll_runs"].includes(r.entity_type) ? r.entity_id : null);
    const href = runId ? `/runs/${runId}` : ["config", "payroll_configurations"].includes(r.entity_type) ? "/configuration" : r.entity_type === "worker" ? `/workers?worker=${r.entity_id}` : null;
    return { id: r.id, event: r.event, entityType: r.entity_type, entityId: r.entity_id, actor: UUID.test(r.actor) ? r.actor : r.actor_type, actorType: r.actor_type, correlationId: typeof r.correlation_id === "string" && UUID.test(r.correlation_id) ? r.correlation_id : null, at: r.created_at, refs, href };
  });
  return { items, next: rows.length > limit ? `${items.at(-1)!.at}~${items.at(-1)!.id}` : null, graphTruncated };
}

/** Non-transition events (login, create, config edits). State changes are audited inside cas_transition. References only (S45). */
export async function writeAudit(e: AuditEvent) {
  must(
    await db()
      .from("audit_events")
      .insert({ company_id: e.companyId, event: e.event, entity_type: e.entityType, entity_id: e.entityId, actor: e.actor, actor_type: e.actorType, correlation_id: e.correlationId, refs: e.refs })
      .select("id"),
    "audit insert",
  );
}
