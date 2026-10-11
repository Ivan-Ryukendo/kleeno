// R4.3 hackathon judge company: is_demo, SIMULATION only, live payments OFF, no MFA (judges cannot do TOTP). Idempotent; never pays.
// Needs JUDGE_EMAIL + JUDGE_PASSWORD from the owner (never printed, never in the repo); optional JUDGE_COMPANY_NAME. Prints IDs and status only.
// Run: node node_modules/tsx/dist/cli.mjs --conditions=react-server --env-file=<target env> scripts/seed-judge.ts
// Targets: loopback or pinned kleeno-test; the owner's demo project (R4.4) only with SEED_JUDGE_TARGET_REF=<its project ref>, never the production origin.
import { randomUUID } from "node:crypto";
import { assertDemoLocation, seedSimulationDemo } from "./seed-demo";

type Env = Record<string, string | undefined>;
const ROLES = ["OWNER", "PAYROLL_APPROVER"];

export function assertJudgeCompany(c: { is_demo: boolean; is_sandbox: boolean; live_payments_enabled: boolean }) {
  if (!c.is_demo || c.is_sandbox || c.live_payments_enabled) throw new Error("judge seed requires a demo company with live payments off");
}

export async function seedJudge(env: Env) {
  assertDemoLocation(env.SUPABASE_URL ?? "", env.SUPABASE_PROD_URL, env);
  const email = env.JUDGE_EMAIL?.trim().toLowerCase();
  const password = env.JUDGE_PASSWORD;
  if (!email || !password) throw new Error("set JUDGE_EMAIL and JUDGE_PASSWORD (owner-supplied) for the judge login");
  if (password.length < 12) throw new Error("JUDGE_PASSWORD must be at least 12 characters");
  if (env.SUPABASE_URL !== process.env.SUPABASE_URL) throw new Error("seed requires a designated local demo company with live payments off"); // the server client writes to process.env's target
  const name = env.JUDGE_COMPANY_NAME?.trim() || "Kleeno Judge Demo";
  const { createClient } = await import("@supabase/supabase-js");
  const { db, must } = await import("../src/server/db/client");
  const { writeAudit } = await import("../src/server/db/audit");
  const { auditEvent } = await import("../src/core/audit");

  // Refuse before writing anything: the named company must be a demo company, and the login must not reach a real company.
  const found = must(await db().from("companies").select("id, is_demo, is_sandbox, live_payments_enabled, mfa_required, onboarded_at").eq("name", name), "judge company read");
  if (found.length > 1) throw new Error("judge company name is ambiguous; set a unique JUDGE_COMPANY_NAME");
  if (found[0]) assertJudgeCompany(found[0]);
  let user: { id: string } | undefined;
  for (let page = 1; !user; page++) {
    const r = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error) throw new Error("judge user lookup failed");
    user = r.data.users.find(u => u.email?.toLowerCase() === email);
    if (r.data.users.length < 1000) break;
  }
  if (user) {
    const companies = must(await db().from("memberships").select("companies!inner(is_demo, is_sandbox)").eq("user_id", user.id).is("removed_at", null), "judge memberships read");
    if (companies.some(m => { const c = m.companies as unknown as { is_demo: boolean; is_sandbox: boolean }; return !c.is_demo || c.is_sandbox; })) throw new Error("JUDGE_EMAIL already belongs to a non-demo company; use a dedicated judge login");
    const admin = await db().schema("growth").from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (admin.error || admin.data) throw new Error("JUDGE_EMAIL is a platform admin; use a dedicated judge login");
    const factors = await db().auth.admin.mfa.listFactors({ userId: user.id });
    if (factors.error || factors.data.factors.some(f => f.status === "verified")) throw new Error("judge login has MFA enrolled; judges cannot use TOTP, use a dedicated judge login");
    const probe = createClient(env.SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
    if ((await probe.auth.signInWithPassword({ email, password })).error) throw new Error("existing judge login does not accept JUDGE_PASSWORD; rotate it or use a new JUDGE_EMAIL");
    await probe.auth.signOut({ scope: "local" });
  }

  const created = { company: !found[0], user: !user, membership: false };
  const company = found[0] ?? must(await db().from("companies").insert({ name, is_demo: true, is_sandbox: false, live_payments_enabled: false, mfa_required: false, onboarded_at: new Date().toISOString() }).select("id, is_demo, is_sandbox, live_payments_enabled, mfa_required, onboarded_at").single(), "judge company insert");
  if (created.company) await writeAudit(auditEvent({ companyId: company.id, event: "company.create", entityType: "company", entityId: company.id, actor: "seed-judge", actorType: "script", correlationId: randomUUID(), refs: { demo: true } }));
  if (company.mfa_required || !company.onboarded_at) { // only this demo company, re-checked in the same statement
    must(await db().from("companies").update({ mfa_required: false, onboarded_at: company.onboarded_at ?? new Date().toISOString() }).eq("id", company.id).eq("is_demo", true).eq("live_payments_enabled", false).select("id").single(), "judge company update");
  }
  if (!user) {
    const r = await db().auth.admin.createUser({ email, password, email_confirm: true });
    if (r.error || !r.data.user) throw new Error("judge user create failed");
    user = r.data.user;
  }
  const member = (await db().from("memberships").select("roles, removed_at").eq("company_id", company.id).eq("user_id", user.id).maybeSingle()).data;
  if (!member) {
    must(await db().from("memberships").insert({ user_id: user.id, company_id: company.id, roles: ROLES, email }).select("user_id"), "judge membership insert");
    created.membership = true;
  } else if (member.removed_at || member.roles.join() !== ROLES.join()) {
    must(await db().from("memberships").update({ roles: ROLES, removed_at: null }).eq("company_id", company.id).eq("user_id", user.id).select("user_id"), "judge membership update");
  }
  const seeded = await seedSimulationDemo(company.id, user.id); // re-checks the target and is_demo / live OFF itself
  return { companyId: company.id as string, userId: user.id, runId: seeded.runId, mode: seeded.mode, status: seeded.status, created };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/seed-judge.ts")) {
  const redact = (m: string) => [process.env.JUDGE_PASSWORD, process.env.JUDGE_EMAIL].reduce<string>((s, v) => (v ? s.replaceAll(v, "[redacted]") : s), m);
  seedJudge(process.env).then(r => console.log(JSON.stringify(r))).catch((e: unknown) => {
    console.error(`judge seed failed: ${redact(e instanceof Error ? e.message : "unknown error")}`);
    process.exitCode = 1;
  });
}
