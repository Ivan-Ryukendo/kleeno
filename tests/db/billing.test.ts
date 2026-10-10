// Authored isolated database acceptance. Never run on the configured remote project.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { billingAdminCommand, listBillingTiers, loadOwnerBilling } from "@/server/db/billing";
import { admin, makeCompany, pendingRun, userClient } from "./helpers";

it("billing catalog revisions, pinned enterprise terms, current access, demo activation and unique signoff usage", async () => {
  const company = await makeCompany({ live: true }), foreign = await makeCompany();
  const staff = { userId: company.payment.id, correlationId: randomUUID() };
  expect((await admin.schema("growth").from("platform_admins").insert({ user_id: staff.userId })).error).toBeNull();
  const tierId = randomUUID();
  const create = { action: "create" as const, id: tierId, expectedRevision: 0, idempotencyKey: randomUUID(), reason: "Catalog baseline", price: { name: "Review test", baseCents: 4900, workerCents: 200 } };
  expect(await billingAdminCommand(staff, create)).toMatchObject({ revision: 1 });
  expect(await billingAdminCommand(staff, create)).toMatchObject({ revision: 1 });
  await expect(billingAdminCommand(staff, { ...create, price: { ...create.price, baseCents: 5000 } })).rejects.toMatchObject({ code: "CONFLICT" });
  const assign = { action: "assign" as const, id: randomUUID(), companyId: company.id, expectedRevision: 0, idempotencyKey: randomUUID(), reason: "BILLING_PRIVATE_CANARY", tierId, tierRevision: 1, price: create.price, usageEnabled: true };
  expect(await billingAdminCommand(staff, assign)).toMatchObject({ revision: 1 });
  expect(await billingAdminCommand(staff, assign)).toMatchObject({ revision: 1 });
  const owner = { userId: company.payroll.id, companyId: company.id };
  expect((await loadOwnerBilling(owner)).price).toEqual(create.price);
  await billingAdminCommand(staff, { ...create, action: "revise", expectedRevision: 1, idempotencyKey: randomUUID(), price: { ...create.price, baseCents: 9900 } });
  expect((await loadOwnerBilling(owner)).price?.baseCents).toBe(4900);
  await expect(billingAdminCommand(staff, { ...assign, expectedRevision: 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  await billingAdminCommand(staff, { action: "archive", id: tierId, expectedRevision: 2, idempotencyKey: randomUUID(), reason: "Retire test tier" });
  expect((await listBillingTiers(staff)).tiers.find(t => t.id === tierId)).toMatchObject({ archived: true, revision: 3 });
  const enterprise = { ...assign, idempotencyKey: randomUUID(), expectedRevision: 1, tierId: null, tierRevision: null, price: { name: "Negotiated enterprise", baseCents: 12345, workerCents: 150 } };
  await billingAdminCommand(staff, enterprise);
  expect((await loadOwnerBilling(owner)).price).toEqual(enterprise.price);
  const ciphertext = await admin.from("billing_company_events").select("payload_enc").eq("company_id", company.id);
  expect(JSON.stringify(ciphertext.data)).not.toContain("CANARY"); expect(JSON.stringify(ciphertext.data)).not.toContain("12345");
  const peer = await userClient(company.payment), other = await userClient(foreign.payroll);
  expect((await peer.from("billing_company_events").select("id").eq("company_id", company.id)).data).toEqual([]);
  expect((await other.from("billing_company_events").select("id").eq("company_id", company.id)).data).toEqual([]);
  await expect(loadOwnerBilling({ userId: company.payment.id, companyId: company.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await peer.rpc("billing_catalog_command", { p_actor: staff.userId, p_correlation: randomUUID(), p_command: {} })).error).not.toBeNull();
  expect((await admin.schema("growth").from("billing_tiers").update({ base_cents: 1 }).eq("id", tierId)).error).not.toBeNull();
  expect((await admin.from("billing_company_events").update({ usage_enabled: false }).eq("company_id", company.id)).error).not.toBeNull();

  const run = await pendingRun(company), at = new Date().toISOString();
  expect((await admin.from("import_batches").insert({ company_id: company.id, run_id: run.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: company.payroll.id, created_at: at })).error).toBeNull();
  expect((await admin.from("payroll_review_settings").insert({ company_id: company.id, run_id: run.runId, revision: 1, cutoff_at: new Date(Date.now() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], updated_by: company.payroll.id })).error).toBeNull();
  const event = { id: randomUUID(), action: "SIGNOFF", calculation_id: run.saved.calculationId, calculation_hash: run.calc.calculationHash, expected_revision: 0, idempotency_key: randomUUID(), command_hash: "a".repeat(64), settings_revision: 1, payload_enc: null };
  const signoff = () => admin.rpc("append_payroll_review", { p_company: company.id, p_run: run.runId, p_actor: company.payroll.id, p_correlation: randomUUID(), p_event: event });
  expect((await signoff()).data).toMatchObject({ code: "OK" }); expect((await signoff()).data).toMatchObject({ code: "OK" });
  const usage = await admin.from("billing_worker_usage").select("*").eq("company_id", company.id);
  expect(usage.data).toHaveLength(1); expect(usage.data?.[0]).toMatchObject({ review_event_id: event.id, month: at.slice(0, 7) + "-01" });
  expect((await admin.from("billing_worker_usage").update({ month: "2020-01-01" }).eq("company_id", company.id)).error).not.toBeNull();

  const demo = await makeCompany(); expect((await admin.from("companies").update({ is_demo: true }).eq("id", demo.id)).error).toBeNull();
  const activation = { action: "activate_demo" as const, id: randomUUID(), companyId: demo.id, expectedRevision: 0, idempotencyKey: randomUUID(), reason: "Prepared demo activation" };
  expect(await billingAdminCommand(staff, activation)).toMatchObject({ revision: 1 }); expect(await billingAdminCommand(staff, activation)).toMatchObject({ revision: 1 });
  const demoView = await loadOwnerBilling({ userId: demo.payroll.id, companyId: demo.id });
  expect(demoView.demo.state).toBe("ACTIVE"); expect(Date.parse(demoView.demo.expiresAt!) - Date.parse(demoView.demo.activatedAt!)).toBe(48 * 3600000);
  await expect(billingAdminCommand(staff, { ...assign, companyId: demo.id, tierId: null, tierRevision: null, expectedRevision: 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await admin.from("companies").select("live_payments_enabled").eq("id", demo.id).single()).data?.live_payments_enabled).toBe(false);
  await admin.schema("growth").from("platform_admins").delete().eq("user_id", staff.userId);
  await expect(billingAdminCommand(staff, create)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
