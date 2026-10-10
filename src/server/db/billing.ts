import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { BillingCommandSchema, BILLING_GATES, demoState, usageMonth, type BillingCommand, type BillingTier, type Price } from "@/core/billing";
import { WorkflowError } from "@/core/workflow";
import { TransitionError } from "@/core/domain/machines";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { db, must } from "./client";
import { isPlatformAdmin } from "./growth";
import { loadBillingProvider } from "./billing-provider";
import { loadBillingCollection } from "./billing-collection";
interface Staff { userId: string; correlationId?: string }
interface Owner { userId: string; companyId: string }
async function admin(who: Staff) { if (!await isPlatformAdmin(who.userId)) throw new WorkflowError("FORBIDDEN", "Current billing administration access is required"); }
async function owner(who: Owner) {
  const result = await db().from("memberships").select("roles").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("billing access unavailable");
  if (!result.data?.roles.includes("OWNER")) throw new WorkflowError("FORBIDDEN", "Current company owner access is required");
}
export async function listBillingTiers(who: Staff) {
  await admin(who);
  const result = await db().schema("growth").from("billing_tiers").select("id,revision,name,base_cents,worker_cents,archived", { count: "exact" }).order("name").limit(1000);
  const rows = must(result, "billing catalog");
  if (result.count !== rows.length) throw new WorkflowError("CONFLICT", "The catalog exceeds the supported view; contact support");
  await admin(who);
  return { tiers: rows.map(row => ({ id: row.id, revision: row.revision, name: row.name, baseCents: row.base_cents, workerCents: row.worker_cents, archived: row.archived } as BillingTier)), gates: BILLING_GATES };
}
export async function billingAdminCommand(who: Staff, input: BillingCommand) {
  const command = BillingCommandSchema.parse(input); await admin(who);
  const correlation = who.correlationId ?? randomUUID();
  let result: { code: string; revision?: number };
  if (command.action === "assign" || command.action === "activate_demo") {
    const eventId = randomUUID();
    const hash = await fingerprint(command.companyId, { actorId: who.userId, command });
    result = must(await db().rpc("billing_company_command", { p_company: command.companyId, p_actor: who.userId, p_correlation: correlation, p_command: { ...command, event_id: eventId, command_hash: hash, payload_enc: await sealJson(command.companyId, "billing_company_events", "payload_enc", eventId, { reason: command.reason, ...(command.action === "assign" ? { price: command.price } : {}) }) } }), "billing company command");
  } else {
    // Platform catalog contains public commercial prices, not payroll/company confidential content.
    result = must(await db().rpc("billing_catalog_command", { p_actor: who.userId, p_correlation: correlation, p_command: { ...command, idempotency_key: command.idempotencyKey, command_hash: createHash("sha256").update(JSON.stringify({ actorId: who.userId, command })).digest("hex") } }), "billing catalog command");
  }
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current access cannot change billing");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Billing revision or command changed; refresh before continuing");
  return { revision: result.revision, gates: BILLING_GATES };
}
async function companyView(companyId: string, check: () => Promise<void>) {
  await check();
  const history = await db().from("billing_company_events").select("id,revision,action,payload_enc,created_at,tier_id,tier_revision,usage_enabled", { count: "exact" }).eq("company_id", companyId).order("revision", { ascending: false }).limit(1000);
  const rows = must(history, "billing terms");
  if (history.count !== rows.length) throw new WorkflowError("CONFLICT", "Billing history exceeds the supported view; contact support");
  const assignment = rows.find(row => row.action === "assign"), demo = rows.find(row => row.action === "activate_demo");
  const now = new Date().toISOString(), month = usageMonth(now);
  const count = await db().from("billing_worker_usage").select("worker_id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", month);
  if (count.error || count.count === null) throw new Error("billing usage unavailable");
  const subscription = await loadBillingProvider(companyId);
  const collection = await loadBillingCollection(companyId, check);
  await check();
  const terms = assignment ? await openJson<{ price: Price; reason: string }>(companyId, "billing_company_events", "payload_enc", assignment.id, assignment.payload_enc) : null;
  await check(); // access may have been revoked while the company key/decryption was awaited
  return { companyId, revision: rows[0]?.revision ?? 0, price: terms?.price ?? null, tierId: assignment?.tier_id ?? null, tierRevision: assignment?.tier_revision ?? null, usageEnabled: assignment?.usage_enabled ?? false, usage: { month, uniqueWorkers: count.count, status: "PREVIEW" }, demo: { state: demoState(demo?.created_at ?? null, now), activatedAt: demo?.created_at ?? null, expiresAt: demo ? new Date(Date.parse(demo.created_at) + 48 * 3600000).toISOString() : null }, subscription, collection, gates: BILLING_GATES };
}
export async function loadOwnerBilling(who: Owner) { return companyView(who.companyId, () => owner(who)); }
export async function loadAdminBilling(who: Staff, companyId: string) {
  await admin(who);
  const company = await db().from("companies").select("id").eq("id", companyId).maybeSingle();
  if (company.error) throw new Error("billing company unavailable");
  if (!company.data) throw new TransitionError("NOT_FOUND", "Company billing not found");
  return companyView(companyId, () => admin(who));
}
