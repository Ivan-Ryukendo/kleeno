// Creates the payroll approver and payment approver (two different users, rule 18) from env. No passwords in the repo.
// Needs: PAYROLL_APPROVER_EMAIL/PASSWORD, PAYMENT_APPROVER_EMAIL/PASSWORD in .env. Idempotent.
import { db, must } from "@/server/db/client";
import { COMPANY_ID, fail } from "./_lib";

const users = [
  { role: "PAYROLL_APPROVER", email: process.env.PAYROLL_APPROVER_EMAIL, password: process.env.PAYROLL_APPROVER_PASSWORD },
  { role: "PAYMENT_APPROVER", email: process.env.PAYMENT_APPROVER_EMAIL, password: process.env.PAYMENT_APPROVER_PASSWORD },
];

async function main() {
  for (const u of users) {
    if (!u.email || !u.password) fail(`set ${u.role}_EMAIL / _PASSWORD in .env (names in .env.example)`);
    if (u.password.length < 12) fail(`${u.role} password must be at least 12 characters`);
  }
  const existing = must(await db().auth.admin.listUsers({ perPage: 200 }).then((r) => ({ data: r.data?.users ?? null, error: r.error })), "list users");
  for (const u of users) {
    let id = existing.find((x) => x.email === u.email)?.id;
    if (!id) {
      const created = await db().auth.admin.createUser({ email: u.email!, password: u.password!, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("create user failed");
      id = created.data.user.id;
    }
    must(await db().from("app_users").upsert({ id, company_id: COMPANY_ID, role: u.role }, { onConflict: "id" }).select("id"), "app_users save");
    console.log(`${u.role}: ${u.email} ready`);
  }
}

main().catch((e) => {
  console.error("create-users failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
