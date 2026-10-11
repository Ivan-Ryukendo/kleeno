import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GET, PATCH } from "@/app/api/profile/timezone/route";
import { loadProfileTimezone } from "@/server/db/profile-timezone";
import { admin, call, cookieFor, joinCompany, makeCompany, userClient } from "./helpers";

const path = "/api/profile/timezone";
const preferences = () => admin.schema("growth").from("user_preferences");

describe("private per-user timezone preference", () => {
  it("falls back to company timezone, saves only self, and clears preference", async () => {
    const company = await makeCompany();
    expect((await admin.from("companies").update({ timezone: "Asia/Dhaka" }).eq("id", company.id)).error).toBeNull();
    const { cookie } = await cookieFor(company.payroll);
    const before = await call(GET, { method: "GET", cookie, path });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ preferenceTimezone: null, timeZone: "Asia/Dhaka", source: "company" });
    const saved = await call(PATCH, { method: "PATCH", cookie, path, body: { timezone: "America/New_York" } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ preferenceTimezone: "America/New_York", source: "user" });
    expect((await preferences().select("timezone").eq("user_id", company.payment.id).maybeSingle()).data).toBeNull();
    const cleared = await call(PATCH, { method: "PATCH", cookie, path, body: { timezone: null } });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ preferenceTimezone: null, timeZone: "Asia/Dhaka", source: "company" });
  });
  it("keeps the same user's preference across companies and isolates other users", async () => {
    const a = await makeCompany(), b = await makeCompany();
    await joinCompany(a.payroll, b.id, ["VIEWER"]);
    expect((await preferences().upsert({ user_id: a.payroll.id, timezone: "Europe/London" })).error).toBeNull();
    expect(await loadProfileTimezone({ userId: a.payroll.id, companyId: b.id })).toMatchObject({ timeZone: "Europe/London", source: "user" });
    expect(await loadProfileTimezone({ userId: b.payroll.id, companyId: b.id })).toMatchObject({ preferenceTimezone: null });
    await expect(loadProfileTimezone({ userId: b.payroll.id, companyId: a.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies unsigned, revoked, cross-user body injection and invalid zones", async () => {
    const company = await makeCompany();
    const { cookie } = await cookieFor(company.payroll);
    expect((await call(GET, { method: "GET", path })).status).toBe(401);
    for (const body of [{ timezone: "UTC+6" }, { timezone: "UTC", userId: company.payment.id }, { timezone: "UTC", companyId: company.id }]) {
      expect((await call(PATCH, { method: "PATCH", cookie, path, body })).status).toBe(400);
    }
    expect((await preferences().select("timezone").eq("user_id", company.payroll.id).maybeSingle()).data).toBeNull();
    expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", company.id).eq("user_id", company.payroll.id)).error).toBeNull();
    expect((await call(PATCH, { method: "PATCH", cookie, path, body: { timezone: "UTC" } })).status).toBe(403);
  });
  it("enforces private-schema grants/RLS and validates direct service writes", async () => {
    const company = await makeCompany();
    const inventory = await admin.rpc("growth_inventory");
    expect(inventory.error).toBeNull();
    expect(inventory.data.find((row: { table_name: string }) => row.table_name === "user_preferences")).toMatchObject({ rls_enabled: true, anon_any: false, authenticated_any: false, schema_usage_anon: false, schema_usage_authenticated: false });
    const clients = [await userClient(company.payroll), createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })];
    for (const client of clients) {
      expect((await client.schema("growth").from("user_preferences").select("*")).error).not.toBeNull();
      expect((await client.schema("growth").from("user_preferences").upsert({ user_id: company.payroll.id, timezone: "UTC" })).error).not.toBeNull();
    }
    expect((await preferences().upsert({ user_id: company.payroll.id, timezone: "UTC+6" })).error?.code).toBe("22023");
    expect((await preferences().upsert({ user_id: company.payroll.id, timezone: "Asia/Dhaka" })).error).toBeNull();
  });
});
