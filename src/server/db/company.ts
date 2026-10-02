import "server-only";
import { auditEvent } from "@/core/audit";
import { profileComplete, type Basics, type CompanyProfile, type Schedule } from "@/core/company";
import type { SetupFacts } from "@/core/setup";
import { WorkflowError } from "@/core/workflow";
import { writeAudit } from "./audit";
import { db, must } from "./client";

export interface CompanyInfo {
  id: string;
  isSandbox: boolean;
  isDemo: boolean;
  mfaRequired: boolean;
  liveEnabled: boolean;
  onboardedAt: string | null;
  profile: CompanyProfile;
}

const COLUMNS = "id, name, is_sandbox, is_demo, mfa_required, live_payments_enabled, onboarded_at, country, timezone, size_range, industry, pay_frequency, pay_day";

export async function getCompany(companyId: string): Promise<CompanyInfo> {
  const r = must(await db().from("companies").select(COLUMNS).eq("id", companyId).maybeSingle(), "company read");
  return {
    id: r.id,
    isSandbox: r.is_sandbox,
    isDemo: r.is_demo,
    mfaRequired: r.mfa_required,
    liveEnabled: r.live_payments_enabled,
    onboardedAt: r.onboarded_at,
    profile: { name: r.name, country: r.country, timezone: r.timezone, sizeRange: r.size_range, industry: r.industry, payFrequency: r.pay_frequency, payDay: r.pay_day },
  };
}

// A new company starts in SIMULATION with live payments off (S64). Sandbox companies can never switch live payments on (DB CHECK).
// Real companies require MFA (S43); sandboxes for judges do not, to keep the demo friction-free.
export async function createCompany(input: { name: string; isSandbox: boolean; createdBy: string; correlationId: string; event: "company.create" | "company.approve" }) {
  const row = must(await db().from("companies").insert({ name: input.name.trim().slice(0, 120) || "New company", is_sandbox: input.isSandbox, is_demo: false, live_payments_enabled: false, mfa_required: !input.isSandbox }).select("id").single(), "company insert");
  await writeAudit(auditEvent({ companyId: row.id, event: input.event, entityType: "company", entityId: row.id, actor: input.createdBy, actorType: "user", correlationId: input.correlationId, refs: { sandbox: input.isSandbox } }));
  return { id: row.id as string };
}

interface Who {
  companyId: string;
  userId: string;
  correlationId: string;
}

/** Saves the basics and/or the pay schedule (Owner only, checked by the route). The wizard finishes when both are present. */
export async function updateProfile(who: Who, patch: Partial<Basics> & Partial<Schedule>) {
  const columns = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.country !== undefined && { country: patch.country }),
    ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    ...(patch.sizeRange !== undefined && { size_range: patch.sizeRange }),
    ...(patch.industry !== undefined && { industry: patch.industry }),
    ...(patch.payFrequency !== undefined && { pay_frequency: patch.payFrequency, pay_day: patch.payDay ?? null }),
  };
  must(await db().from("companies").update(columns).eq("id", who.companyId).select("id"), "company update");
  await writeAudit(auditEvent({ companyId: who.companyId, event: "company.profile", entityType: "company", entityId: who.companyId, actor: who.userId, actorType: "user", correlationId: who.correlationId, refs: { fields: Object.keys(columns).join(",") } }));
  const after = await getCompany(who.companyId);
  if (!after.onboardedAt && profileComplete(after.profile)) {
    must(await db().from("companies").update({ onboarded_at: new Date().toISOString() }).eq("id", who.companyId).is("onboarded_at", null).select("id"), "company onboarded");
    await writeAudit(auditEvent({ companyId: who.companyId, event: "company.onboarded", entityType: "company", entityId: who.companyId, actor: who.userId, actorType: "user", correlationId: who.correlationId }));
    return { ...after, onboardedAt: new Date().toISOString() };
  }
  return after;
}

const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => (await q).count ?? 0;

/** What the dashboard checklist is computed from (docs/pages.md). Counts only; nothing sensitive. */
export async function setupFacts(companyId: string): Promise<SetupFacts> {
  const exact = { count: "exact" as const, head: true };
  const [members, pending, workers, configs, runs] = await Promise.all([
    count(db().from("memberships").select("user_id", exact).eq("company_id", companyId).is("removed_at", null)),
    count(db().from("invites").select("id", exact).eq("company_id", companyId).eq("issuer", "OWNER")),
    count(db().from("workers").select("id", exact).eq("company_id", companyId)),
    count(db().from("payroll_configurations").select("id", exact).eq("company_id", companyId).in("status", ["APPROVED", "ACTIVE", "SUPERSEDED"])),
    count(db().from("payroll_runs").select("id", exact).eq("company_id", companyId)),
  ]);
  return { teamInvited: members > 1 || pending > 0, workers, policyApproved: configs > 0, runs };
}

const DAILY_LIMIT = 5;

/**
 * An Owner creates another company (S64): at most 5 per day, SIMULATION with live payments off. An Owner who only owns sandbox
 * companies can only create sandbox companies, so a judge's sandbox can never grow into a real one.
 */
export async function createAnotherCompany(user: { userId: string; email: string | null }, name: string, correlationId: string) {
  const owned = must(await db().from("memberships").select("roles, companies(is_sandbox)").eq("user_id", user.userId).is("removed_at", null), "ownerships read") as unknown as { roles: string[]; companies: { is_sandbox: boolean } | null }[];
  const owners = owned.filter((m) => m.roles.includes("OWNER"));
  if (owners.length === 0) throw new WorkflowError("FORBIDDEN", "only an Owner can create another company");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const made = await count(db().from("audit_events").select("id", { count: "exact", head: true }).eq("event", "company.create").eq("actor", user.userId).gte("created_at", since));
  if (made >= DAILY_LIMIT) throw new WorkflowError("FORBIDDEN", "you can create up to 5 companies a day; try again tomorrow");
  const company = await createCompany({ name, isSandbox: owners.every((m) => m.companies?.is_sandbox), createdBy: user.userId, correlationId, event: "company.create" });
  must(await db().from("memberships").insert({ user_id: user.userId, company_id: company.id, roles: ["OWNER"], email: user.email?.toLowerCase() ?? null }).select("user_id"), "owner membership");
  return company;
}
