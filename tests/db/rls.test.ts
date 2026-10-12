// S10 (every table: company_id NOT NULL + RLS), S11 (authenticated read-only own company, anon nothing), S43 (MFA-aware RLS).
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { activeConfig, admin, approvedRun, makeCompany, totp, userClient, type TestCompany } from "./helpers";

let a: TestCompany;
let b: TestCompany;
let inventory: { table_name: string; rls_enabled: boolean; has_company_id: boolean; company_id_not_null: boolean; anon_any: boolean; authenticated_select: boolean; authenticated_write: boolean; truncate_guarded: boolean }[];
const NO_SELECT = new Set(["company_keys", "gateway_transfers"]); // wrapped data keys and saved burn/operator signatures are never readable through the public API (20261008000006)

beforeAll(async () => {
  a = await makeCompany({ live: true });
  b = await makeCompany({ live: true });
  await approvedRun(a, await activeConfig(a)); // rows in many tables for company A
  inventory = (await admin.rpc("security_inventory")).data;
});

describe("S10 every table", () => {
  it("the catalog lists the tables, so a new table without RLS fails here", () => {
    expect(inventory.length).toBeGreaterThanOrEqual(16);
  });
  it("has company_id NOT NULL and RLS enabled", () => {
    expect(inventory.filter((t) => !t.has_company_id || !t.company_id_not_null).map((t) => t.table_name)).toEqual([]);
    expect(inventory.filter((t) => !t.rls_enabled).map((t) => t.table_name)).toEqual([]);
  });
});

describe("S11 API roles", () => {
  it("anon has no table rights; authenticated has no write rights anywhere", () => {
    expect(inventory.filter((t) => t.anon_any).map((t) => t.table_name)).toEqual([]);
    expect(inventory.filter((t) => t.authenticated_write).map((t) => t.table_name)).toEqual([]);
  });
  it("authenticated can select every table except the key table", () => {
    expect(inventory.filter((t) => t.authenticated_select === NO_SELECT.has(t.table_name)).map((t) => t.table_name)).toEqual([]);
  });
  it("immutable tables have a truncate guard", () => {
    const need = ["audit_events", "calculations", "calculation_lines", "payroll_approvals", "compensations", "obligations", "payment_batches", "payroll_runs", "payroll_configurations"];
    const guarded = new Set(inventory.filter((t) => t.truncate_guarded).map((t) => t.table_name));
    expect(need.filter((t) => !guarded.has(t))).toEqual([]);
  });

  it("anon key reads nothing and writes nothing", async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const t of inventory.map((x) => x.table_name)) {
      const r = await anon.from(t).select("*").limit(1);
      expect(r.data ?? [], t).toEqual([]);
    }
    const w = await anon.from("workers").insert({ company_id: a.id, pseudonym: "W999", pay_type: "SALARIED" });
    expect(w.error).not.toBeNull();
  });

  it("a user sees their own company's rows in every table and none of another company's", async () => {
    const ua = await userClient(a.payroll);
    const ub = await userClient(b.payroll);
    for (const t of inventory.map((x) => x.table_name).filter((n) => !NO_SELECT.has(n))) {
      const own = await ua.from(t).select("company_id").limit(50);
      expect(own.error, t).toBeNull();
      expect((own.data ?? []).every((r: { company_id: string }) => r.company_id === a.id), t).toBe(true);
      const cross = await ub.from(t).select("company_id").eq("company_id", a.id);
      expect(cross.data ?? [], t).toEqual([]);
    }
    expect(((await ua.from("workers").select("id")).data ?? []).length).toBeGreaterThan(0);
  });

  it("a user JWT cannot write through the public API (insert, update, delete, rpc)", async () => {
    const ua = await userClient(a.payroll);
    expect((await ua.from("workers").insert({ company_id: a.id, pseudonym: "W998", pay_type: "SALARIED" })).error).not.toBeNull();
    expect((await ua.from("workers").update({ active: false }).eq("company_id", a.id).select("id")).data ?? []).toEqual([]);
    expect((await ua.from("audit_events").delete().eq("company_id", a.id).select("id")).data ?? []).toEqual([]);
    expect((await ua.from("companies").update({ live_payments_enabled: false }).eq("id", a.id).select("id")).data ?? []).toEqual([]);
    const rpc = await ua.rpc("cas_transition", { p_table: "payroll_runs", p_company: a.id, p_id: a.id, p_from: "DRAFT", p_to: "DRAFT", p_entity_type: "x", p_event: "x", p_actor: "x", p_actor_type: "user", p_correlation: "x", p_refs: {} });
    expect(rpc.error).not.toBeNull();
    expect((await ua.from("company_keys").select("*")).error).not.toBeNull();
  });
});

describe("S43 MFA-aware RLS", () => {
  it("a password-only (aal1) session in an MFA company sees no rows; after TOTP (aal2) it does", async () => {
    const m = await makeCompany({ live: false, mfa: true });
    const client = await userClient(m.payroll);
    expect((await client.from("companies").select("id").eq("id", m.id)).data ?? []).toEqual([]);

    const enrol = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `t-${Date.now()}` });
    expect(enrol.error).toBeNull();
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrol.data!.id, code: totp(enrol.data!.totp.secret) });
    expect(verified.error).toBeNull();
    const after = await client.from("companies").select("id").eq("id", m.id);
    expect(after.data).toHaveLength(1);
  });
});
