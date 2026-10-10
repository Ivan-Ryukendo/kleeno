// Authored isolated acceptance; vitest.db.config refuses remote/production targets.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { defaultView } from "@/core/views";
import { createNamedView, listNamedViews, loadNamedView, namedViewAction } from "@/server/db/named-views";
import { POST } from "@/app/api/tables/[table]/named-views/route";
import { admin, call, cookieFor, makeCompany, userClient } from "./helpers";

async function fixture() {
  const company = await makeCompany(), other = await makeCompany();
  const who = { companyId: company.id, userId: company.payroll.id, roles: company.payroll.roles, correlationId: randomUUID() };
  const create = { action: "create" as const, scope: "PERSONAL" as const, name: "PRIVATE-named-view", view: { ...defaultView("workers", who.roles), search: "PRIVATE-filter" }, idempotencyKey: randomUUID() };
  const raw = (change: Record<string, unknown> = {}) => ({ p_company: company.id, p_table: "workers", p_actor: who.userId, p_correlation: who.correlationId, p_view: randomUUID(), p_version: randomUUID(), p_scope: "PERSONAL", p_action: "CREATE", p_expected_revision: 0, p_idempotency_key: randomUUID(), p_command_hash: "a".repeat(64), p_payload_enc: "encrypted-test-envelope", ...change });
  const rpc = (args: ReturnType<typeof raw>) => admin.rpc("append_named_table_view", args);
  return { company, other, who, create, raw, rpc };
}

it("round-trips encrypted definitions, keeps immutable versions and archives without changing personal defaults", async () => {
  const f = await fixture(), created = await createNamedView(admin, f.who, "workers", f.create);
  const retry = await createNamedView(admin, f.who, "workers", f.create);
  expect(retry).toEqual(created);
  expect(await loadNamedView(admin, f.who, "workers", created.id)).toMatchObject({ name: f.create.name, view: f.create.view, revision: 1, available: true });
  await namedViewAction(admin, f.who, "workers", created.id, { action: "update", expectedRevision: 1, idempotencyKey: randomUUID(), name: "PRIVATE-update", view: f.create.view });
  const archive = { action: "archive" as const, expectedRevision: 2, idempotencyKey: randomUUID() };
  expect(await namedViewAction(admin, f.who, "workers", created.id, archive)).toMatchObject({ revision: 3 });
  expect(await namedViewAction(admin, f.who, "workers", created.id, archive)).toMatchObject({ revision: 3 });
  expect(await loadNamedView(admin, f.who, "workers", created.id)).toMatchObject({ archived: true, name: null, view: null, available: false, history: [{ revision: 3 }, { revision: 2 }, { revision: 1 }] });
  const versions = await admin.from("named_table_view_versions").select("*").eq("company_id", f.company.id);
  expect(versions.error).toBeNull(); expect(versions.data).toHaveLength(3); expect(JSON.stringify(versions.data)).not.toContain("PRIVATE-");
  const audit = await admin.from("audit_events").select("*").eq("company_id", f.company.id).eq("entity_type", "named_view");
  expect(audit.data).toHaveLength(3); expect(JSON.stringify(audit.data)).not.toContain("PRIVATE-");
  expect((await admin.from("table_layouts").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  for (const table of ["named_table_views", "named_table_view_versions"]) {
    expect((await admin.from(table).update({ company_id: f.other.id }).eq("company_id", f.company.id)).error).not.toBeNull();
    expect((await admin.from(table).delete().eq("company_id", f.company.id)).error).not.toBeNull();
  }
});

it("isolates personal/team RLS and blocks public/direct writes and RPC calls", async () => {
  const f = await fixture();
  const personal = await createNamedView(admin, f.who, "workers", f.create);
  const team = await createNamedView(admin, f.who, "workers", { ...f.create, scope: "TEAM", idempotencyKey: randomUUID() });
  const own = await userClient(f.company.payroll), peer = await userClient(f.company.payment), foreign = await userClient(f.other.payroll);
  expect((await own.from("named_table_views").select("id").eq("company_id", f.company.id)).data).toHaveLength(2);
  expect((await peer.from("named_table_views").select("id").eq("company_id", f.company.id)).data).toEqual([{ id: team.id }]);
  expect((await peer.from("named_table_view_versions").select("view_id").eq("company_id", f.company.id)).data).toEqual([{ view_id: team.id }]);
  expect((await foreign.from("named_table_views").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  expect((await foreign.from("named_table_view_versions").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  for (const client of [own, peer, foreign]) {
    expect((await client.from("named_table_views").insert({ id: randomUUID(), company_id: f.company.id, table_id: "workers", scope: "TEAM", owner_id: f.who.userId, revision: 1 })).error).not.toBeNull();
    expect((await client.from("named_table_views").update({ archived: true }).eq("id", personal.id)).error).not.toBeNull();
    expect((await client.from("named_table_view_versions").delete().eq("view_id", personal.id)).error).not.toBeNull();
    expect((await client.rpc("append_named_table_view", f.raw())).error).not.toBeNull();
  }
  await expect(loadNamedView(admin, { ...f.who, userId: f.company.payment.id }, "workers", personal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("serializes identical retries, rejects changed commands and allows one concurrent revision winner", async () => {
  const f = await fixture(), event = f.raw();
  const repeated = await Promise.all([f.rpc(event), f.rpc({ ...event, p_version: randomUUID() })]);
  expect(repeated.map(r => r.data)).toEqual([{ code: "OK", id: event.p_view, revision: 1 }, { code: "OK", id: event.p_view, revision: 1 }]);
  expect((await f.rpc({ ...event, p_view: randomUUID(), p_version: randomUUID() })).data).toEqual({ code: "OK", id: event.p_view, revision: 1 });
  expect((await f.rpc({ ...event, p_command_hash: "b".repeat(64) })).data?.code).toBe("CONFLICT");
  expect((await f.rpc({ ...event, p_expected_revision: 1 })).data?.code).toBe("CONFLICT");
  const update = f.raw({ p_view: event.p_view, p_action: "UPDATE", p_expected_revision: 1 });
  const race = await Promise.all([f.rpc(update), f.rpc({ ...update, p_version: randomUUID(), p_idempotency_key: randomUUID() })]);
  expect(race.map(r => r.data?.code).sort()).toEqual(["CONFLICT", "OK"]);
  expect((await f.rpc(f.raw({ p_view: event.p_view, p_action: "UPDATE", p_expected_revision: 1 }))).data?.code).toBe("CONFLICT");
  expect((await admin.from("named_table_view_versions").select("id").eq("view_id", event.p_view)).data).toHaveLength(2);
  expect((await f.rpc(f.raw({ p_actor: f.other.payroll.id }))).data?.code).toBe("FORBIDDEN");
});

it("rechecks current team authority and redacts incompatible names, search and filters", async () => {
  const f = await fixture(), team = await createNamedView(admin, f.who, "workers", { ...f.create, scope: "TEAM" });
  const viewerWho = { ...f.who, userId: f.company.payment.id };
  expect((await admin.from("memberships").update({ roles: ["VIEWER"] }).eq("company_id", f.company.id).eq("user_id", viewerWho.userId)).error).toBeNull();
  const detail = await loadNamedView(admin, viewerWho, "workers", team.id);
  expect(detail).toMatchObject({ available: false, name: null, view: null, canEdit: false }); expect(JSON.stringify(detail)).not.toContain("PRIVATE-");
  const cookie = await cookieFor(f.company.payment);
  expect((await call(POST, { cookie: cookie.cookie, body: { ...f.create, scope: "TEAM", idempotencyKey: randomUUID() } }, { params: Promise.resolve({ table: "workers" }) })).status).toBe(403);
  await expect(namedViewAction(admin, viewerWho, "workers", team.id, { action: "archive", expectedRevision: 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", f.company.id).eq("user_id", viewerWho.userId)).error).toBeNull();
  await expect(listNamedViews(admin, viewerWho, "workers")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await f.rpc(f.raw({ p_actor: viewerWho.userId }))).data?.code).toBe("FORBIDDEN");
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", f.company.id).eq("user_id", f.who.userId)).error).toBeNull();
  await expect(createNamedView(admin, f.who, "workers", { ...f.create, scope: "TEAM" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("retains archived history and refuses later updates or forged scope/identity", async () => {
  const f = await fixture(), event = f.raw(); expect((await f.rpc(event)).data?.code).toBe("OK");
  expect((await f.rpc(f.raw({ p_view: event.p_view, p_scope: "TEAM", p_action: "UPDATE", p_expected_revision: 1 }))).data?.code).toBe("CONFLICT");
  expect((await f.rpc(f.raw({ p_view: event.p_view, p_actor: f.company.payment.id, p_action: "ARCHIVE", p_expected_revision: 1, p_payload_enc: null }))).data?.code).toBe("NOT_FOUND");
  expect((await f.rpc(f.raw({ p_view: event.p_view, p_action: "ARCHIVE", p_expected_revision: 1, p_payload_enc: null }))).data?.code).toBe("OK");
  expect((await f.rpc(f.raw({ p_view: event.p_view, p_action: "UPDATE", p_expected_revision: 2 }))).data?.code).toBe("CONFLICT");
  expect((await admin.from("named_table_view_versions").select("action,payload_enc").eq("view_id", event.p_view).order("revision")).data).toEqual([{ action: "CREATE", payload_enc: event.p_payload_enc }, { action: "ARCHIVE", payload_enc: null }]);
});

it("withholds both metadata and ciphertext from an aal1 session when company MFA is required", async () => {
  const f = await fixture(), event = f.raw(); expect((await f.rpc(event)).data?.code).toBe("OK");
  expect((await admin.from("companies").update({ mfa_required: true }).eq("id", f.company.id)).error).toBeNull();
  const passwordOnly = await userClient(f.company.payroll);
  expect((await passwordOnly.from("named_table_views").select("id").eq("company_id", f.company.id)).data).toEqual([]);
  expect((await passwordOnly.from("named_table_view_versions").select("payload_enc").eq("company_id", f.company.id)).data).toEqual([]);
});
