// Deletion on request (S44): removes ALL data of one company and its wrapped data key, and the sign-in accounts of its users.
// Irreversible. Usage: npm run script -- scripts/delete-company.ts <company-id> --yes
// Runs against the project in .env (SUPABASE_URL): check the host printed first. Platform backups age out on Supabase's schedule;
// without the deleted data key their encrypted fields are unreadable.
import { db, must } from "@/server/db/client";
import { env } from "@/server/env";

async function main() {
  const [id, flag] = process.argv.slice(2);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("usage: delete-company.ts <company-id> --yes");
  const company = (await db().from("companies").select("name").eq("id", id).maybeSingle()).data;
  if (!company) throw new Error("no such company in this project");
  console.log(`project ${new URL(env.SUPABASE_URL).hostname} · company "${company.name}"`);
  if (flag !== "--yes") throw new Error("this deletes everything for that company and cannot be undone: add --yes to proceed");

  const users = must(await db().from("app_users").select("id").eq("company_id", id), "users read").map((u) => u.id as string);
  const res = await db().rpc("delete_company", { p_company: id });
  if (res.error) throw new Error(`deletion failed (${res.error.code}); nothing was changed`);
  let accounts = 0;
  for (const u of users) if (!(await db().auth.admin.deleteUser(u)).error) accounts++;
  const rows = Object.values(res.data as Record<string, number>).reduce((s, n) => s + Number(n), 0);
  console.log(`deleted ${rows} rows across ${Object.keys(res.data as object).length} tables and ${accounts} of ${users.length} sign-in accounts`);
}

main().catch((e) => {
  console.error("delete-company failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
