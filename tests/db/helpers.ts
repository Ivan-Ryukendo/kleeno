// Shared setup for DB tests. Runs against a real Supabase; creates fresh, uniquely named test companies and users per run.
// Immutable rows remain in the disposable stack or pinned test project; never dev/prod.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { keccak256, toHex } from "viem";
import type { ConfigParams } from "@/core/config";
import { obligationMachine, runMachine, type ObligationState, type RunState } from "@/core/domain/machines";
import { applyTransition, type StateStore } from "@/core/domain/transition";
import { calculatePayroll, type EngineEntry } from "@/core/engine";
import { parseUsdc } from "@/core/money";
import { computePlanHash } from "@/core/payments/plan-hash";
import type { Role } from "@/core/workflow";
import { jarFromRequest, sessionClient, type PendingCookie } from "@/server/auth/session";
import { saveCalculation } from "@/server/db/calculations";
import { configAction, createConfigDraft, loadConfig } from "@/server/db/configs";
import { runStore } from "@/server/db/runs";
import { dbStore } from "@/server/db/store";
import { createWorker } from "@/server/db/workers";

const URL_ = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Check the allowlist again before creating clients, without reading any owner configuration.
const host = URL_ ? new URL(URL_).hostname : "";
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
const pinned = host === "axcgcjpmcdujxkvroqox.supabase.co" && process.env.SUPABASE_TEST_PROJECT_REF === "axcgcjpmcdujxkvroqox";
const denyTarget = process.env.DB_TEST_FORBIDDEN_URL;
if (!URL_ || !(loopback || pinned) || (denyTarget && new URL(denyTarget).origin === new URL(URL_).origin)) throw new Error("tests/db refuses to run: isolated loopback or pinned kleeno-test required");

export const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
export const BASE = "http://localhost:3000";
export const uniq = () => randomBytes(4).toString("hex");
export const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  roles: Role[];
  companyId: string;
}
export interface TestCompany {
  id: string;
  payroll: TestUser;
  payment: TestUser;
}

export async function makeCompany(opts: { live?: boolean; mfa?: boolean } = {}): Promise<TestCompany> {
  const { data, error } = await admin.from("companies").insert({ name: `dbtest-${uniq()}`, is_demo: false, live_payments_enabled: opts.live ?? false, mfa_required: opts.mfa ?? false, per_payment_ceiling: 1_000_000_000_000_000, live_status: opts.live ? "PROVISIONED" : "NOT_REQUESTED" }).select("id").single(); // test amounts are large; the ceiling has its own test
  if (error) throw new Error("company insert failed");
  const mk = async (roles: Role[]): Promise<TestUser> => {
    const email = `dbtest-${uniq()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (u.error || !u.data.user) throw new Error("user create failed");
    const row = await admin.from("memberships").insert({ user_id: u.data.user.id, company_id: data.id, roles, email });
    if (row.error) throw new Error("membership insert failed");
    return { id: u.data.user.id, email, password, roles, companyId: data.id };
  };
  return { id: data.id, payroll: await mk(["OWNER", "PAYROLL_APPROVER"]), payment: await mk(["PAYMENT_APPROVER"]) };
}

/** An existing login joins a company (one login, many companies). */
export async function joinCompany(u: TestUser, companyId: string, roles: Role[]) {
  const row = await admin.from("memberships").insert({ user_id: u.id, company_id: companyId, roles, email: u.email });
  if (row.error) throw new Error("membership insert failed");
}

/** A plain supabase-js client signed in as the user (RLS applies). `company` sets the active-company header the server sends. */

export async function userClient(u: TestUser, company?: string): Promise<SupabaseClient> {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: company ? { headers: { "x-kleeno-company": company } } : undefined });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in failed");
  return c;
}

/** Signs in through the same cookie code the handlers use and returns a Cookie header for handler calls. */
export async function cookieFor(u: TestUser): Promise<{ cookie: string; jar: PendingCookie[] }> {
  const sink: PendingCookie[] = [];
  const { error } = await sessionClient([], sink).auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in failed");
  return { cookie: sink.map((c) => `${c.name}=${c.value}`).join("; "), jar: sink };
}

export function call(handler: (r: Request, ctx?: never) => Promise<Response>, init: { method?: string; cookie?: string; body?: unknown; origin?: string | null; path?: string; ip?: string } = {}, ctx?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null) headers.origin = init.origin ?? BASE;
  if (init.ip) headers["x-real-ip"] = init.ip;
  const req = new Request(`${BASE}${init.path ?? "/api/test"}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return (handler as (r: Request, c?: unknown) => Promise<Response>)(req, ctx);
}
export const withId = (id: string) => ({ params: Promise.resolve({ id }) });
export { jarFromRequest };

// --- TOTP (RFC 6238) so tests can complete MFA enrolment ---
function base32(s: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

// --- domain builders (use the real repositories and machines) ---
export const CONFIG_PARAMS: ConfigParams = {
  scheduledHoursPerPeriod: "160",
  weeklyOvertimeThresholdHours: "40",
  overtimeMultiplier: "1.5",
  hourlyCapHours: null,
  aboveCapMultiplier: "1.0",
  deductions: [{ code: "TAX", label: "Tax", percent: "10" }],
  varianceTolerance: "0.01",
  rules: [{ ruleId: "BASE_SALARY", clauseIds: ["C1"] }],
};
export const CANARY_CLAUSE = "CANARY-CLAUSE-policy-text-7788";
export const CANARY_BASE = "1234567.891011";

export async function activeConfig(c: TestCompany) {
  const who = { companyId: c.id, userId: c.payroll.id, roles: c.payroll.roles };
  const draft = await createConfigDraft(who, { params: CONFIG_PARAMS, clauses: [{ id: "C1", text: CANARY_CLAUSE }] });
  for (const a of ["validate", "request_review", "approve", "activate"]) await configAction(who, draft.id, a);
  return { ...draft, config: (await loadConfig(c.id, draft.version))!.config };
}

export async function step<S extends string>(store: StateStore<S>, m: Parameters<typeof applyTransition<S>>[1], c: TestCompany, id: string, actions: string[], by = "test") {
  for (const action of actions) await applyTransition(store, m, { id, companyId: c.id, action, actor: by, actorType: "script", correlationId: randomUUID() });
}

export interface BuiltRun {
  runId: string;
  workerId: string;
  calculationId: string;
  approvalId: string;
  lineId: string;
  obligationId: string;
  hash: string;
  config: Awaited<ReturnType<typeof activeConfig>>["config"];
  recipient: string;
}

/** A LIVE run taken through the real machine to PENDING_APPROVAL (needs live payments ON for the company). `extra` adds more workers to the same run. */
export async function pendingRun(c: TestCompany, cfg?: Awaited<ReturnType<typeof activeConfig>>, workerNo = 1, extra = 0) {
  const config = (cfg ?? (await activeConfig(c))).config;
  const workers: { workerId: string; recipient: string }[] = [];
  for (let i = 0; i <= extra; i++) {
    const n = workerNo + i;
    const recipient = ADDR(0xa000 + n + Math.floor(Math.random() * 1e6));
    const { id: workerId } = await createWorker({ companyId: c.id, userId: c.payroll.id, correlationId: randomUUID() }, { pseudonym: `W${String(100 + n)}`, payType: "SALARIED", compensation: { baseAmount: parseUsdc(CANARY_BASE), hourlyRate: 0n } });
    await admin.from("workers").update({ wallet_address: recipient, wallet_id: randomUUID(), wallet_confirmed_address: recipient }).eq("id", workerId);
    workers.push({ workerId, recipient });
  }
  const { workerId, recipient } = workers[0];
  const run = await admin.from("payroll_runs").insert({ company_id: c.id, mode: "LIVE_TESTNET", period_start: "2026-10-01", period_end: "2026-10-31", config_version: config.version, created_by: c.payroll.id }).select("id").single();
  if (run.error) throw new Error(`run insert failed: ${run.error.message}`);
  const runId = run.data.id;
  await step<RunState>(runStore, runMachine, c, runId, ["import_data", "start_reconciliation", "finish_reconciliation", "calculate"]);
  const entries: EngineEntry[] = workers.map((w) => ({ worker: { workerId: w.workerId, payType: "SALARIED", baseAmount: parseUsdc(CANARY_BASE), hourlyRate: 0n }, input: { workedHours: "160" } }));
  const calc = calculatePayroll(config, entries);
  const saved = await saveCalculation(c.id, runId, config, entries, calc);
  await step<RunState>(runStore, runMachine, c, runId, ["validate_calculation", "submit_for_approval"]);
  return { runId, workerId, recipient, workers, config, calc, saved };
}

/** A LIVE run taken to APPROVED with one CREATED obligation. */
export async function approvedRun(c: TestCompany, cfg?: Awaited<ReturnType<typeof activeConfig>>, workerNo = 1): Promise<BuiltRun> {
  const { runId, workerId, recipient, config, calc, saved } = await pendingRun(c, cfg, workerNo);
  const ap = await admin.from("payroll_approvals").insert({ company_id: c.id, run_id: runId, calculation_id: saved.calculationId, calculation_hash: calc.calculationHash, approver_id: c.payroll.id }).select("id").single();
  if (ap.error) throw new Error(`approval insert failed: ${ap.error.message}`);
  await step<RunState>(runStore, runMachine, c, runId, ["approve"]);
  const obligationId = randomUUID();
  const ob = await admin.from("obligations").insert({ id: obligationId, company_id: c.id, run_id: runId, worker_id: workerId, calculation_line_id: saved.lineIds.get(workerId)!, approval_id: ap.data.id, amount: Number(calc.lines[0].net), currency: "USDC", network: "ARC-TESTNET", recipient, config_version: config.version, calculation_hash: calc.calculationHash, idempotency_key: randomUUID(), onchain_key: keccak256(toHex(obligationId)) });
  if (ob.error) throw new Error(`obligation insert failed: ${ob.error.message}`);
  return { runId, workerId, calculationId: saved.calculationId, approvalId: ap.data.id, lineId: saved.lineIds.get(workerId)!, obligationId, hash: calc.calculationHash, config, recipient };
}

export async function proposedBatch(c: TestCompany, r: BuiltRun, authorizerId: string | null) {
  const plan = { obligations: [{ id: r.obligationId, amount: "1", recipient: r.recipient }], heldIds: [] as string[], source: "FALLBACK" };
  const b = await admin.from("payment_batches").insert({ company_id: c.id, run_id: r.runId, plan_hash: computePlanHash({ ...plan, obligations: plan.obligations.map((o) => ({ ...o, amount: 1n })) }), plan, authorizer_id: authorizerId }).select("id").single();
  if (b.error) throw new Error(`batch insert failed: ${b.error.message}`);
  return b.data.id as string;
}

export const stores = { obligations: dbStore<ObligationState>("obligations"), obligationMachine };

/** Runs one statement as the table owner (the service role has least-privilege grants, e.g. SELECT-only on billing_worker_usage). Only for isolated fixtures. */
export async function asOwner(sql: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect();
  try { return await client.query(sql, params); } finally { await client.end(); }
}
