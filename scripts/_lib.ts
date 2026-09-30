import { db, must } from "@/server/db/client";

// P1 scripts run against the synthetic dev "Pilot Co" (supabase/seed.sql). Payments run from scripts only (rule 41).
export const COMPANY_ID = "00000000-0000-4000-8000-000000000002";

export async function wallets() {
  const rows = must(await db().from("company_wallets").select("*").eq("company_id", COMPANY_ID), "wallets read");
  const by = (role: string) => rows.find((r) => r.role === role);
  return { approver: by("APPROVER"), agent: by("AGENT") };
}

export async function company() {
  return must(await db().from("companies").select("*").eq("id", COMPANY_ID).single(), "company read");
}

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
