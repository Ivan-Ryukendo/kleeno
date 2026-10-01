// Grants (or revokes) access to the private lead list (docs/phases/W.md, S52). The only way to become an admin.
// Needs ADMIN_EMAIL and ADMIN_PASSWORD (>= 12 chars) in .env; creates the auth user if missing. Idempotent.
//   npm run script -- scripts/add-platform-admin.ts            -> kleeno-dev
//   npm run script -- scripts/add-platform-admin.ts --prod     -> kleeno-prod (SUPABASE_PROD_URL / SUPABASE_PROD_SERVICE_ROLE_KEY)
//   add --remove to revoke. The admin then signs in at /<ADMIN_PATH>/login and enrols TOTP on first sign-in.
//   Recovery: --reset-password sets the password to ADMIN_PASSWORD; --reset-mfa deletes the authenticator (lost phone),
//   so the next sign-in enrols a new one. Both can be combined with --prod.
import { createClient } from "@supabase/supabase-js";
import { fail } from "./_lib";

const prod = process.argv.includes("--prod");
const remove = process.argv.includes("--remove");
const resetPassword = process.argv.includes("--reset-password");
const resetMfa = process.argv.includes("--reset-mfa");
const url = prod ? process.env.SUPABASE_PROD_URL : process.env.SUPABASE_URL;
const key = prod ? process.env.SUPABASE_PROD_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

async function main() {
  if (!url || !key) fail(`set ${prod ? "SUPABASE_PROD_URL / SUPABASE_PROD_SERVICE_ROLE_KEY" : "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"} in .env`);
  if (!email) fail("set ADMIN_EMAIL in .env (names in .env.example)");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const users = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (users.error) fail("could not list users");
  let id = users.data.users.find((u) => u.email?.toLowerCase() === email)?.id;

  if (remove) {
    if (id) {
      const res = await sb.schema("growth").from("platform_admins").delete().eq("user_id", id);
      if (res.error) fail("could not remove the admin row");
    }
    console.log(`${email}: not an admin`);
    return;
  }

  if ((!id || resetPassword) && (!password || password.length < 12)) fail("set ADMIN_PASSWORD (at least 12 characters) in .env");
  if (!id) {
    const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) fail("could not create the user");
    id = created.data.user.id;
  } else if (resetPassword) {
    const updated = await sb.auth.admin.updateUserById(id, { password });
    if (updated.error) fail("could not reset the password");
    console.log(`${email}: password reset to ADMIN_PASSWORD`);
  }
  if (resetMfa) {
    const factors = await sb.auth.admin.mfa.listFactors({ userId: id });
    if (factors.error) fail("could not list authenticator factors");
    for (const f of factors.data.factors) {
      const del = await sb.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
      if (del.error) fail("could not delete an authenticator factor");
    }
    console.log(`${email}: ${factors.data.factors.length} authenticator(s) removed; the next sign-in enrols a new one`);
  }
  const res = await sb.schema("growth").from("platform_admins").upsert({ user_id: id }, { onConflict: "user_id" });
  if (res.error) fail(`could not save the admin row (${res.error.code}); is the growth schema exposed in the API settings?`);
  console.log(`${email}: admin on ${prod ? "kleeno-prod" : "kleeno-dev"}. Sign in at /<ADMIN_PATH>/login and enrol TOTP.`);
}

main().catch((e) => fail(`add-platform-admin failed: ${e instanceof Error ? e.message : "unknown error"}`));
