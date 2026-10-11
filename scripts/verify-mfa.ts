// R3.5 / S43 / S16 / S66: end-to-end MFA verification through the real route handlers, in-process, with throwaway users.
// Usage: tsx --require ./scripts/_stub-server-only.cjs --env-file=.env.test scripts/verify-mfa.ts --target test   (dev: --env-file=.env, --target dev)
// Targets only the pinned kleeno-test project or kleeno-dev. Prints no secrets. Creates and deletes its own company and users.
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { POST as adminEnroll } from "@/app/api/admin/mfa/enroll/route";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { POST as adminVerify } from "@/app/api/admin/mfa/verify/route";
import { GET as adminAccounts } from "@/app/api/admin/accounts/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as enroll } from "@/app/api/auth/mfa/enroll/route";
import { POST as verify } from "@/app/api/auth/mfa/verify/route";
import { POST as invite } from "@/app/api/invites/route";
import { POST as createWorker } from "@/app/api/workers/route";
import { requireTotp } from "@/server/auth/login";
import { AuthError, jarFromRequest, sessionClient } from "@/server/auth/session";

const REFS = { test: "axcgcjpmcdujxkvroqox", dev: "odyvakaycvhzjxjqqdvb" } as const;
const target = process.argv[process.argv.indexOf("--target") + 1] as keyof typeof REFS;
if (!(target in REFS)) throw new Error("usage: --target test|dev");
const URL_ = process.env.SUPABASE_URL ?? "";
if (new URL(URL_).hostname !== `${REFS[target]}.supabase.co` || process.env.NEXT_PUBLIC_SUPABASE_URL !== URL_) throw new Error(`environment is not the ${target} project; refusing`);

const BASE = "http://localhost:3000";
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

// RFC 6238 TOTP from the enrolment secret (what an authenticator app does).
function totp(secret: string, offset = 0) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// A cookie jar that behaves like a browser: Set-Cookie from each response is merged into the next request.
class Browser {
  jar = new Map<string, string>();
  get cookie() { return [...this.jar].map(([n, v]) => `${n}=${v}`).join("; "); }
  async call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") {
    const res = await handler(new Request(`${BASE}${path}`, { method, headers: { "content-type": "application/json", origin: BASE, cookie: this.cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (!value || attrs.some((x) => /max-age=0/i.test(x))) this.jar.delete(name); else this.jar.set(name, value);
    }
    const json = await res.clone().json().catch(() => ({}));
    return { status: res.status, code: json?.error?.code as string | undefined, json };
  }
  sessionClient() { return sessionClient(jarFromRequest(new Request(BASE, { headers: { cookie: this.cookie } }))); }
}

const uniq = () => randomBytes(4).toString("hex");
const users: string[] = [];
let companyId = "";
async function mkUser(label: string) {
  const email = `r35-${label}-${uniq()}@example.com`, password = `pw-${randomUUID()}`;
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error || !u.data.user) throw new Error("user create failed");
  users.push(u.data.user.id);
  return { id: u.data.user.id, email, password };
}
const auditCount = async (event: string, userId: string) => (await admin.from("audit_events").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("entity_id", userId).eq("event", event)).count ?? 0;
const worker = (n: number) => ({ pseudonym: `W${900 + n}`, payType: "SALARIED", baseAmount: "1000" });

async function main() {
  console.log(`target ${target} (${new URL(URL_).hostname}) at ${new Date().toISOString()}`);
  process.env.SITE_MODE = "app";
  const gate = randomBytes(16).toString("hex");
  process.env.ADMIN_PATH = gate;

  // --- company with MFA required, one Owner + payroll approver ---
  const c = await admin.from("companies").insert({ name: `r35-${uniq()}`, is_demo: false, mfa_required: true }).select("id").single();
  if (c.error) throw new Error("company insert failed");
  companyId = c.data.id;
  const owner = await mkUser("owner");
  if ((await admin.from("memberships").insert({ user_id: owner.id, company_id: companyId, roles: ["OWNER", "PAYROLL_APPROVER"], email: owner.email })).error) throw new Error("membership failed");

  // 1. password login: aal1, reply says enrol
  const b = new Browser();
  const bad = await b.call(login, "/api/auth/login", { email: owner.email, password: "wrong-password" });
  check("login with a wrong password -> 401 and LOGIN_FAILED audited", bad.status === 401 && (await auditCount("LOGIN_FAILED", owner.id)) === 1);
  const l1 = await b.call(login, "/api/auth/login", { email: owner.email, password: owner.password });
  check("password login ok; server says MFA enrolment is next", l1.status === 200 && l1.json.next === "enrol");

  // 2. aal1 refused on MFA-required routes; RLS shows nothing (S43)
  const r1 = await b.call(createWorker, "/api/workers", worker(1));
  check("aal1 session refused on an MFA route: 401 MFA_REQUIRED", r1.status === 401 && r1.code === "MFA_REQUIRED");
  const rls1 = await b.sessionClient().from("companies").select("id").eq("id", companyId);
  check("aal1 session sees 0 company rows under RLS", (rls1.data ?? []).length === 0);

  // 3. enrol TOTP; a wrong code fails (throttled + audited); the right one upgrades to aal2
  const en = await b.call(enroll, "/api/auth/mfa/enroll", {});
  check("aal1 may start TOTP enrolment", en.status === 200 && !!en.json.secret && !!en.json.factorId);
  const secret = en.json.secret as string, factorId = en.json.factorId as string;
  const wrong = await b.call(verify, "/api/auth/mfa/verify", { factorId, code: totp(secret) === "000000" ? "111111" : "000000" });
  check("wrong TOTP code -> 401 and MFA_FAILED audited", wrong.status === 401 && (await auditCount("MFA_FAILED", owner.id)) === 1);
  const ok = await b.call(verify, "/api/auth/mfa/verify", { factorId, code: totp(secret) });
  check("correct TOTP code -> 200, MFA_OK audited", ok.status === 200 && (await auditCount("MFA_OK", owner.id)) === 1);
  check("RLS sees the company after aal2", ((await b.sessionClient().from("companies").select("id").eq("id", companyId)).data ?? []).length === 1);
  const w2 = await b.call(createWorker, "/api/workers", worker(2));
  check("aal2 session accepted on the same MFA route", w2.status === 200);

  // 4. a fresh browser: password login now asks for MFA; stays aal1 until the code; a second enrolment needs the existing factor first
  const b2 = new Browser();
  const l2 = await b2.call(login, "/api/auth/login", { email: owner.email, password: owner.password });
  check("second sign-in: server says an MFA code is next", l2.status === 200 && l2.json.next === "mfa" && l2.json.factorId === factorId);
  check("aal1 again refused on the MFA route", (await b2.call(createWorker, "/api/workers", worker(3))).status === 401);
  const re = await b2.call(enroll, "/api/auth/mfa/enroll", {});
  check("a second enrolment from an aal1 session is refused (stolen password cannot add a device)", re.status === 401 && re.code === "MFA_REQUIRED");
  const v2 = await b2.call(verify, "/api/auth/mfa/verify", { factorId, code: totp(secret, 1) });
  check("aal2 login with a TOTP code from the secret", v2.status === 200 && (await b2.call(createWorker, "/api/workers", worker(4))).status === 200);

  // 5. re-authentication (S16/rule 47): an aal2 session alone is not enough to grant authority
  const inv = (password?: string) => b2.call(invite, "/api/invites", { email: `r35-inv-${uniq()}@example.com`, roles: ["PAYROLL_APPROVER"], ...(password === undefined ? {} : { password }) });
  const none = await inv();
  check("valid aal2 session without a password -> 401 on an authority-granting action", none.status === 401);
  const wrongPw = await inv("not-the-password");
  check("wrong password -> 401 and REAUTH_FAILED audited", wrongPw.status === 401 && (await auditCount("REAUTH_FAILED", owner.id)) === 1);
  check("right password in the same request -> 200", (await inv(owner.password)).status === 200);
  const viewerInvite = await b2.call(invite, "/api/invites", { email: `r35-inv-${uniq()}@example.com`, roles: ["VIEWER"] });
  check("a non-authority invite needs no re-auth", viewerInvite.status === 200);

  // 6. fresh TOTP re-auth building block (S66; S75 alternative route is not shipped)
  const sc = b2.sessionClient();
  const act = { companyId, userId: owner.id };
  const rejected = await requireTotp(sc, act, "000000", randomUUID()).then(() => "passed", (e) => (e instanceof AuthError ? e.status : "other"));
  check("requireTotp: wrong code -> 401", rejected === 401);
  const accepted = await requireTotp(sc, act, totp(secret, -1), randomUUID()).then(() => "passed", (e) => String(e?.message ?? e));
  check("requireTotp: fresh code accepted", accepted === "passed"); // previous-window code: GoTrue accepts one step of clock skew and refuses reused codes

  // 7. throttle: the 5 failures above + more -> 429, even with the right password
  for (let i = 0; i < 5; i++) await inv("still-wrong");
  const throttled = await inv(owner.password);
  check("after repeated failures the right password is throttled -> 429", throttled.status === 429);

  // 8. platform admin: password + aal2 + secret gate
  const adm = await mkUser("admin");
  if ((await admin.schema("growth").from("platform_admins").insert({ user_id: adm.id })).error) throw new Error("platform admin insert failed");
  const ab = new Browser();
  const h = { "x-kleeno-admin-gate": gate };
  check("admin route without the secret gate -> 404", (await ab.call(adminLogin, "/api/admin/login", { email: adm.email, password: adm.password })).status === 404);
  const al = await ab.call(adminLogin, "/api/admin/login", { email: adm.email, password: adm.password }, h);
  check("admin password step ok; MFA enrolment is next", al.status === 200 && al.json.next === "enrol");
  const a1 = await ab.call(adminAccounts, "/api/admin/accounts", undefined, h, "GET");
  check("admin aal1 refused: 401 MFA_REQUIRED", a1.status === 401 && a1.code === "MFA_REQUIRED");
  const ae = await ab.call(adminEnroll, "/api/admin/mfa/enroll", {}, h);
  const av = await ab.call(adminVerify, "/api/admin/mfa/verify", { factorId: ae.json.factorId, code: totp(ae.json.secret) }, h);
  check("admin enrols and verifies TOTP", ae.status === 200 && av.status === 200);
  check("admin aal2 accepted", (await ab.call(adminAccounts, "/api/admin/accounts", undefined, h, "GET")).status === 200);
  const nonAdmin = await new Browser().call(adminLogin, "/api/admin/login", { email: owner.email, password: owner.password }, h);
  check("a non-admin cannot use the admin login (same reply as a wrong password)", nonAdmin.status === 401);
}

async function settings() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return console.log("SKIP  auth settings (no SUPABASE_ACCESS_TOKEN)");
  const ref = REFS[target];
  const headers = { authorization: `Bearer ${token}` };
  const p = await fetch("https://api.supabase.com/v1/projects", { headers });
  const name = ((await p.json().catch(() => [])) as { id: string; name: string }[]).find?.((x) => x.id === ref)?.name;
  console.log(`project ${ref} is named "${name}"`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers });
  if (!r.ok) return check(`auth settings readable via Management API (HTTP ${r.status})`, false);
  const s = (await r.json()) as Record<string, unknown>;
  check("S43 setting: TOTP MFA enrol enabled", s.mfa_totp_enroll_enabled === true);
  check("S43 setting: TOTP MFA verify enabled", s.mfa_totp_verify_enabled === true);
  check("S43 setting: email confirmation on (mailer_autoconfirm false)", s.mailer_autoconfirm === false);
  check("S43 setting: sign-up disabled (disable_signup true)", s.disable_signup === true);
  check("S43 setting: password minimum length >= 12", typeof s.password_min_length === "number" && s.password_min_length >= 12);
  console.log(`INFO  site_url=${String(s.site_url)} uri_allow_list=${String(s.uri_allow_list)}`);
}

async function cleanup() {
  if (companyId) {
    // The one sanctioned deletion path (S44 invariant): the CLI, run in a child process with the same environment.
    const r = spawnSync("npx", ["tsx", "--require", "./scripts/_stub-server-only.cjs", "scripts/delete-company.ts", companyId, "--yes"], { shell: true, encoding: "utf8" });
    console.log(r.status === 0 ? "cleanup: company rows deleted" : "cleanup: delete-company failed");
  }
  await admin.schema("growth").from("platform_admins").delete().in("user_id", users);
  let deleted = 0;
  for (const id of users) if (!(await admin.auth.admin.deleteUser(id)).error) deleted++;
  console.log(`cleanup: ${deleted}/${users.length} users deleted`);
}

main().then(settings).catch((e) => { check(`script error: ${e instanceof Error ? e.message : "unknown"}`, false); }).finally(async () => {
  await cleanup();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
});
