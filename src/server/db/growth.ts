import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { CONSENT_VERSION, LEAD_ACTIONS, hasSurvey, normalizeEmail, type JoinBody, type LeadAction, type LeadRow, type SurveyBody } from "@/core/growth";
import { db, must } from "@/server/db/client";
import { env } from "@/server/env";

// Waitlist repository (docs/phases/W.md). The growth schema is reachable only with the service role (S51);
// emails and notes never go to logs or error messages (S57).
const g = () => db().schema("growth");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Keyed hash for rate-limit keys (IP, email): never stored with a contact, swept after a day (S55). */
export const keyOf = (value: string) => createHmac("sha256", env.WAITLIST_SECRET).update(value).digest("hex");

/** The caller's IP as a rate-limit key. Vercel sets x-real-ip / x-forwarded-for itself. */
export const clientKey = (request: Request) =>
  keyOf(request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown");

/** Fixed-window limit in the DB (serverless instances share nothing). True = allowed. */
export async function allow(bucket: string, key: string, windowSeconds: number, max: number) {
  return must(await g().rpc("hit_rate_limit", { p_bucket: bucket, p_key_hash: key, p_window_seconds: windowSeconds, p_max: max }), "rate limit") as boolean;
}

const profileArgs = (b: Omit<SurveyBody, "token">) => ({
  p_role: b.role ?? null,
  p_company_name: b.companyName ?? null,
  p_company_size: b.companySize ?? null,
  p_pain_point: b.painPoint ?? null,
  p_budget_band: b.budgetBand ?? null,
  p_wants_call: b.wantsCall ?? null,
});

/**
 * Sign-up. Returns the continuation token for the survey step, or null when the survey came with the sign-up.
 * A repeat email changes nothing but still gets a (decoy) token, so the reply never reveals who has joined (S53, S54).
 */
export async function joinWaitlist(b: JoinBody): Promise<string | null> {
  const token = hasSurvey(b) ? null : randomBytes(32).toString("base64url");
  must(
    await g().rpc("join_waitlist", {
      p_email: normalizeEmail(b.email),
      p_consent_version: CONSENT_VERSION,
      p_source: b.source || null,
      p_utm_source: b.utmSource || null,
      p_utm_medium: b.utmMedium || null,
      p_utm_campaign: b.utmCampaign || null,
      p_token_hash: token && sha256(token),
      ...profileArgs(b),
    }),
    "join",
  );
  return token;
}

/** Survey after sign-up. False = unknown, used or expired token (the route answers the same either way). */
export async function completeSurvey(b: SurveyBody) {
  return must(await g().rpc("complete_survey", { p_token_hash: sha256(b.token), ...profileArgs(b) }), "survey") as boolean;
}

export async function isPlatformAdmin(userId: string) {
  const res = await g().from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (res.error) throw new Error(`db admin check failed (${res.error.code})`);
  return !!res.data;
}

// ---- Admin reads

export interface Survey {
  pain_point: string | null;
  budget_band: string | null;
  wants_call: boolean | null;
  completed_at: string;
}
export interface Contact {
  id: string;
  email: string;
  role: string | null;
  company_name: string | null;
  company_size: string | null;
  status: string;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  consent_version: string;
  consented_at: string;
  notes: string | null;
  next_action_at: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  surveys: Survey | null;
}

export interface ContactFilter {
  q?: string;
  status?: string;
  role?: string;
  source?: string;
  pain?: string;
  budget?: string;
  call?: "yes" | "no";
  from?: string; // YYYY-MM-DD, inclusive
  to?: string;
  page?: number;
}
export const PAGE_SIZE = 50;

// PostgREST may return a one-to-one embed as an object or a one-item array.
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const withSurvey = <R extends { surveys: unknown }>(r: R) => ({ ...r, surveys: one(r.surveys as Survey | Survey[] | null) });
// Filter values are checked against allow-lists by the caller; free text is stripped to safe characters before it enters a filter string.
const safe = (s: string) => s.replace(/[^\w@.+ -]/g, "").trim();

export async function listContacts(f: ContactFilter) {
  const onSurvey = !!(f.pain || f.budget || f.call);
  let q = g()
    .from("contacts")
    .select(onSurvey ? "*, surveys!inner(*)" : "*, surveys(*)", { count: "exact" })
    .order("created_at", { ascending: false });
  const groups: string[] = [];
  const text = f.q && safe(f.q);
  if (text) groups.push(`email.ilike."*${text}*",company_name.ilike."*${text}*"`);
  const source = f.source && safe(f.source);
  if (source) groups.push(`utm_source.eq."${source}",source.eq."${source}"`);
  if (groups.length === 1) q = q.or(groups[0]);
  if (groups.length === 2) q = q.or(`and(or(${groups[0]}),or(${groups[1]}))`);
  if (f.status) q = q.eq("status", f.status);
  if (f.role) q = q.eq("role", f.role);
  if (f.pain) q = q.eq("surveys.pain_point", f.pain);
  if (f.budget) q = q.eq("surveys.budget_band", f.budget);
  if (f.call) q = q.eq("surveys.wants_call", f.call === "yes");
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lt("created_at", new Date(Date.parse(f.to) + 86_400_000).toISOString());
  const page = f.page ?? 0;
  const res = await q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (res.error) throw new Error(`db contacts list failed (${res.error.code})`);
  return { rows: (res.data as unknown as Contact[]).map(withSurvey), total: res.count ?? 0 };
}

export async function getContact(id: string) {
  const res = await g()
    .from("contacts")
    .select("*, surveys(*), contact_events(from_status, to_status, created_at)")
    .eq("id", id)
    .order("created_at", { referencedTable: "contact_events", ascending: false })
    .maybeSingle();
  if (res.error) throw new Error(`db contact read failed (${res.error.code})`);
  if (!res.data) return null;
  return withSurvey(res.data as unknown as Contact & { contact_events: { from_status: string; to_status: string; created_at: string }[] });
}

/** Every row, 1000 at a time (the API caps a page at 1000). */
async function everything<T>(select: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await g().from("contacts").select(select).order("created_at").range(from, from + 999);
    if (res.error) throw new Error(`db contacts read failed (${res.error.code})`);
    out.push(...(res.data as T[]));
    if (res.data.length < 1000) return out;
  }
}

export const metricRows = async () =>
  (await everything<LeadRow>("status, is_test, role, source, utm_source, surveys(pain_point, budget_band, wants_call)")).map(withSurvey) as LeadRow[];

export const exportRows = async () => (await everything<Contact>("*, surveys(*)")).map(withSurvey);

// ---- Admin writes

/** Applies a named action; false when the contact is gone or its status changed meanwhile (compare-and-set). */
export async function applyLeadAction(id: string, action: LeadAction, actor: string) {
  const current = await g().from("contacts").select("status").eq("id", id).maybeSingle();
  if (current.error) throw new Error(`db contact read failed (${current.error.code})`);
  if (!current.data) return false;
  const to = LEAD_ACTIONS[action];
  if (current.data.status === to) return true;
  return must(await g().rpc("set_status", { p_contact: id, p_from: current.data.status, p_to: to, p_actor: actor }), "status") as boolean;
}

export async function updateContact(id: string, patch: { notes?: string | null; nextActionAt?: string | null; isTest?: boolean }) {
  const res = await g()
    .from("contacts")
    .update({
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.nextActionAt !== undefined && { next_action_at: patch.nextActionAt }),
      ...(patch.isTest !== undefined && { is_test: patch.isTest }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");
  if (res.error) throw new Error(`db contact update failed (${res.error.code})`);
  return res.data.length === 1;
}

export async function deleteContact(id: string, actor: string) {
  return must(await g().rpc("delete_contact", { p_contact: id, p_actor: actor }), "delete") as boolean;
}

export async function logExport(actor: string, count: number) {
  const res = await g().from("admin_events").insert({ actor, action: "EXPORT", item_count: count });
  if (res.error) throw new Error(`db admin event failed (${res.error.code})`);
}
