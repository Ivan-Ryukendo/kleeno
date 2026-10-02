import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { ClausesSchema, ConfigParamsSchema, configProblems, type Clauses, type ConfigParams, type PayrollConfig } from "@/core/config";
import { configMachine, type ConfigState } from "@/core/domain/machines";
import { applyTransition } from "@/core/domain/transition";
import { isPayrollRole, WorkflowError, type Role } from "@/core/workflow";
import { openJson, sealJson } from "@/server/crypto";
import { writeAudit } from "./audit";
import { db, must } from "./client";
import { dbStore } from "./store";

const store = dbStore<ConfigState>("payroll_configurations");
interface Who {
  companyId: string;
  userId: string;
  role: Role;
  correlationId?: string;
}

/** New DRAFT version. Params and clauses are validated here: the DB only backstops ranges (S35). */
export async function createConfigDraft(who: Who, input: { params: ConfigParams; clauses: Clauses; ai?: { executionId: string; flags: string[] } }) {
  const params = ConfigParamsSchema.parse(input.params);
  const clauses = ClausesSchema.parse(input.clauses);
  const problems = configProblems(params, clauses);
  if (problems.length) throw new WorkflowError("FORBIDDEN", problems.join("; "));
  if (!isPayrollRole(who.role)) throw new WorkflowError("FORBIDDEN", "only the payroll side edits configuration");
  const last = (await db().from("payroll_configurations").select("version").eq("company_id", who.companyId).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  const id = randomUUID();
  const version = (last?.version ?? 0) + 1; // unique (company, version): a concurrent draft fails instead of overwriting
  const clauses_enc = await sealJson(who.companyId, "payroll_configurations", "clauses_enc", id, clauses);
  must(await db().from("payroll_configurations").insert({ id, company_id: who.companyId, version, params, clauses_enc, created_by: who.userId, ai_execution_id: input.ai?.executionId ?? null, validation: { flags: input.ai?.flags ?? [] } }).select("id"), "config insert");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "config.create", entityType: "config", entityId: id, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId(), refs: { version, ai: !!input.ai } }));
  return { id, version };
}

/** DRAFT -> AI_PROPOSED -> VALIDATED -> HUMAN_REVIEW. Validation already ran in the pipeline; each step is one audited transition. */
export async function advanceAiConfig(who: Who, id: string) {
  const base = { id, companyId: who.companyId, correlationId: who.correlationId ?? newCorrelationId() };
  await applyTransition(store, configMachine, { ...base, action: "propose_ai", actor: "policy-interpreter", actorType: "ai" });
  await applyTransition(store, configMachine, { ...base, action: "validate", actor: "validation", actorType: "system" });
  return applyTransition(store, configMachine, { ...base, action: "request_review", actor: "validation", actorType: "system" });
}

/** Lifecycle step by action name. `approve` records the approver first; `activate` supersedes the current ACTIVE version first. */
export async function configAction(who: Who, id: string, action: string, opts: { confirmFlags?: boolean } = {}): Promise<ConfigState> {
  if (!isPayrollRole(who.role)) throw new WorkflowError("FORBIDDEN", "only the payroll side manages configuration");
  const correlationId = who.correlationId ?? newCorrelationId();
  const req = { id, companyId: who.companyId, action, actor: who.userId, actorType: "user" as const, correlationId };
  if (action === "approve") {
    // Values the cited clauses do not support need an explicit yes from HR, recorded with who and when (ARCHITECTURE 7).
    const row = (await db().from("payroll_configurations").select("validation").eq("id", id).eq("company_id", who.companyId).maybeSingle()).data;
    const flags: string[] = row?.validation?.flags ?? [];
    if (flags.length && !opts.confirmFlags) throw new WorkflowError("FLAGS_UNCONFIRMED", "confirm the flagged values before approving");
    if (flags.length) must(await db().from("payroll_configurations").update({ validation: { ...row?.validation, confirmedBy: who.userId, confirmedAt: new Date().toISOString() } }).eq("id", id).eq("company_id", who.companyId).eq("status", "HUMAN_REVIEW").select("id"), "config confirm");
    must(await db().from("payroll_configurations").update({ approved_by: who.userId, approved_at: new Date().toISOString() }).eq("id", id).eq("company_id", who.companyId).eq("status", "HUMAN_REVIEW").select("id"), "config approver");
  }
  if (action === "activate") {
    const active = (await db().from("payroll_configurations").select("id").eq("company_id", who.companyId).eq("status", "ACTIVE").maybeSingle()).data;
    if (active) await applyTransition(store, configMachine, { ...req, id: active.id, action: "supersede" });
  }
  return applyTransition(store, configMachine, req);
}

export async function loadConfig(companyId: string, version: number): Promise<{ id: string; status: ConfigState; config: PayrollConfig; clauses: Clauses } | null> {
  const row = (await db().from("payroll_configurations").select("id, status, params, clauses_enc").eq("company_id", companyId).eq("version", version).maybeSingle()).data;
  if (!row) return null;
  const clauses = await openJson<Clauses>(companyId, "payroll_configurations", "clauses_enc", row.id, row.clauses_enc);
  return { id: row.id, status: row.status, config: { ...ConfigParamsSchema.parse(row.params), version }, clauses };
}

export interface ConfigView {
  id: string;
  version: number;
  status: ConfigState;
  params: ConfigParams;
  clauses: Clauses;
  flags: string[];
  confirmed: boolean;
  aiAssisted: boolean;
  createdAt: string;
}

/** Page read on the user-scoped client (RLS): newest first. Clauses are decrypted here, on the server. */
export async function listConfigs(client: SupabaseClient, companyId: string): Promise<ConfigView[]> {
  const rows = must(await client.from("payroll_configurations").select("id, version, status, params, clauses_enc, validation, ai_execution_id, created_at").eq("company_id", companyId).order("version", { ascending: false }), "configs read");
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      params: ConfigParamsSchema.parse(r.params),
      clauses: await openJson<Clauses>(companyId, "payroll_configurations", "clauses_enc", r.id, r.clauses_enc),
      flags: r.validation?.flags ?? [],
      confirmed: !!r.validation?.confirmedAt,
      aiAssisted: !!r.ai_execution_id,
      createdAt: r.created_at,
    })),
  );
}
