// Authored isolated SQL acceptance only. No Stripe calls; loopback DB config is mandatory.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { billingAdminCommand } from "@/server/db/billing";
import { admin, asOwner, makeCompany, pendingRun, userClient } from "./helpers";

it("closed-month commands dedupe, fence provider stages/late usage, retain UNKNOWN and separate financial authority", async () => {
  const company = await makeCompany({ live: true }), foreign = await makeCompany();
  const actor = company.payroll.id, suffix = randomUUID().replaceAll("-", ""), intent = randomUUID();
  expect((await admin.schema("growth").from("platform_admins").insert({ user_id: actor })).error).toBeNull();
  await billingAdminCommand({ userId: actor }, { action: "assign", id: randomUUID(), companyId: company.id, expectedRevision: 0, idempotencyKey: randomUUID(), reason: "Isolated billing command fixture", tierId: null, tierRevision: null, price: { name: "Review", baseCents: 4900, workerCents: 200 }, usageEnabled: true });
  const assignment = await admin.from("billing_company_events").select("id").eq("company_id", company.id).eq("action", "assign").single();
  expect(assignment.error).toBeNull();
  expect((await admin.rpc("begin_stripe_test_checkout", { p_company: company.id, p_actor: actor, p_intent: intent, p_assignment: assignment.data!.id, p_key: randomUUID(), p_hash: "a".repeat(64) })).data).toMatchObject({ code: "OK" });
  expect((await admin.rpc("bind_stripe_test_checkout", { p_company: company.id, p_actor: actor, p_intent: intent, p_session: `cs_test_${suffix}` })).data).toMatchObject({ code: "OK" });
  const bindingToken = randomUUID();
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: bindingToken })).data).toMatchObject({ code: "OK" });
  expect((await admin.rpc("finish_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: bindingToken, p_seq: 0, p_correlation: randomUUID(), p_observation: { intentId: intent, checkoutId: `cs_test_${suffix}`, customerId: `cus_${suffix}`, subscriptionId: `sub_${suffix}`, status: "active", cancelAtPeriodEnd: false, collectionPaused: false, invoiceId: null, invoiceStatus: null } })).data).toMatchObject({ code: "OK" });

  const run = await pendingRun(company), at = new Date();
  expect((await admin.from("import_batches").insert({ company_id: company.id, run_id: run.runId, import_type: "TIMESHEETS", source_provider: "csv_upload", content_hash: "f".repeat(64), mapping: {}, row_count: 1, rejected_count: 0, created_by: actor, created_at: at.toISOString() })).error).toBeNull();
  expect((await admin.from("payroll_review_settings").insert({ company_id: company.id, run_id: run.runId, revision: 1, cutoff_at: new Date(at.getTime() + 3600000).toISOString(), time_zone: "UTC", required_types: ["TIMESHEETS"], updated_by: actor })).error).toBeNull();
  const event = { id: randomUUID(), action: "SIGNOFF", calculation_id: run.saved.calculationId, calculation_hash: run.calc.calculationHash, expected_revision: 0, idempotency_key: randomUUID(), command_hash: "b".repeat(64), settings_revision: 1, payload_enc: null };
  expect((await admin.rpc("append_payroll_review", { p_company: company.id, p_run: run.runId, p_actor: actor, p_correlation: randomUUID(), p_event: event })).data).toMatchObject({ code: "OK" });
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const commandId = randomUUID(), commandKey = randomUUID();
  const prepare = { p_company: company.id, p_actor: actor, p_id: commandId, p_action: "usage", p_month: month, p_key: commandKey, p_hash: "c".repeat(64), p_payload: "ISOLATED_ENCRYPTED_PAYLOAD_FIXTURE", p_usage: [] };
  expect((await admin.rpc("prepare_billing_collection", prepare)).data).toMatchObject({ code: "OK", id: commandId });
  expect((await admin.rpc("prepare_billing_collection", prepare)).data).toMatchObject({ code: "OK", id: commandId });
  expect((await admin.rpc("prepare_billing_collection", { ...prepare, p_hash: "d".repeat(64) })).data).toMatchObject({ code: "CONFLICT" });
  expect((await admin.rpc("prepare_billing_collection", { ...prepare, p_id: randomUUID(), p_key: randomUUID() })).data).toMatchObject({ code: "CONFLICT" });
  const owner = await userClient(company.payroll, company.id), peer = await userClient(company.payment, company.id), other = await userClient(foreign.payroll, foreign.id);
  expect((await owner.from("billing_collection_commands").select("id").eq("company_id", company.id)).data).toEqual([{ id: commandId }]);
  expect((await peer.from("billing_collection_commands").select("id").eq("company_id", company.id)).data).toEqual([]);
  expect((await other.from("billing_collection_commands").select("id").eq("company_id", company.id)).data).toEqual([]);
  expect((await owner.rpc("claim_billing_collection", { p_company: company.id, p_actor: actor, p_id: commandId, p_token: randomUUID() })).error).not.toBeNull();
  let token = randomUUID();
  const claim = () => admin.rpc("claim_billing_collection", { p_company: company.id, p_actor: actor, p_id: commandId, p_token: token });
  const finish = (stage: number, refs: unknown, done: boolean, requestedToken = token) => admin.rpc("finish_billing_collection", { p_company: company.id, p_actor: actor, p_id: commandId, p_token: requestedToken, p_stage: stage, p_refs: refs, p_done: done, p_correlation: randomUUID() });
  expect((await claim()).data).toMatchObject({ code: "OK", stage: 0 });
  expect((await claim()).data).toMatchObject({ code: "UNKNOWN" });
  expect((await finish(0, { invoiceId: `in_${suffix}`, invoiceStatus: "draft" }, false, randomUUID())).data).toMatchObject({ code: "CONFLICT" });
  expect((await finish(0, { invoiceId: `in_${suffix}`, invoiceStatus: "draft" }, false)).data).toMatchObject({ code: "OK" });
  token = randomUUID(); expect((await claim()).data).toMatchObject({ code: "OK", stage: 1 });
  expect((await finish(1, { itemId: `ii_${suffix}` }, false)).data).toMatchObject({ code: "OK" });
  token = randomUUID(); expect((await claim()).data).toMatchObject({ code: "OK", stage: 2 });
  // Deliberate isolated late-source fixture: same valid review/worker/assignment, arriving after final-stage claim.
  await asOwner("insert into public.billing_worker_usage(company_id, month, worker_id, review_event_id, assignment_id, created_at) values ($1, $2, $3, $4, $5, $6)", [company.id, month, run.workerId, event.id, assignment.data!.id, at.toISOString()]);
  expect((await finish(2, { invoiceId: `in_${suffix}`, invoiceStatus: "open" }, true)).data).toMatchObject({ code: "CONFLICT" });
  await admin.rpc("mark_billing_collection_unknown", { p_company: company.id, p_actor: actor, p_id: commandId, p_token: token });
  expect((await claim()).data).toMatchObject({ code: "UNKNOWN" });
  expect((await admin.from("billing_collection_commands").select("status,stage,invoice_status").eq("id", commandId).single()).data).toEqual({ status: "UNKNOWN", stage: 2, invoice_status: "draft" });
  expect((await admin.from("billing_collection_events").update({ status: "DONE" }).eq("command_id", commandId)).error).not.toBeNull();
  expect((await admin.from("billing_collection_commands").update({ status: "DONE" }).eq("id", commandId)).error).not.toBeNull();
  expect((await admin.from("obligations").select("id").eq("company_id", company.id)).data).toEqual([]);
  // Real SQL cancellation/failure observations preserve the already reviewed payroll and usage.
  const retainedTables = ["workers", "payroll_runs", "calculations", "payroll_review_events", "billing_worker_usage", "billing_company_events"];
  const retained = [];
  for (const table of retainedTables) { const result = await admin.from(table).select("*").eq("company_id", company.id); expect(result.error).toBeNull(); retained.push(result.data); }
  const cancelId = randomUUID(), cancelKey = randomUUID(), cancelToken = randomUUID();
  expect((await admin.rpc("prepare_billing_collection", { ...prepare, p_id: cancelId, p_action: "cancel", p_month: null, p_key: cancelKey, p_hash: "e".repeat(64) })).data).toMatchObject({ code: "OK", id: cancelId });
  expect((await admin.rpc("claim_billing_collection", { p_company: company.id, p_actor: actor, p_id: cancelId, p_token: cancelToken })).data).toMatchObject({ code: "OK", stage: 0 });
  expect((await admin.rpc("finish_billing_collection", { p_company: company.id, p_actor: actor, p_id: cancelId, p_token: cancelToken, p_stage: 0, p_refs: { subscriptionId: `sub_${suffix}` }, p_done: true, p_correlation: randomUUID() })).data).toMatchObject({ code: "OK" });
  // A completed request is not a provider lifecycle observation.
  expect((await admin.from("billing_provider_state").select("status,cancel_at_period_end").eq("company_id", company.id).single()).data).toEqual({ status: "active", cancel_at_period_end: false });
  for (const [status, invoiceStatus] of [["past_due", "open"], ["unpaid", "uncollectible"], ["canceled", "void"]]) {
    const observedToken = randomUUID();
    expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: observedToken })).data).toMatchObject({ code: "OK" });
    expect((await admin.rpc("finish_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: observedToken, p_seq: 0, p_correlation: randomUUID(), p_observation: { intentId: intent, checkoutId: `cs_test_${suffix}`, customerId: `cus_${suffix}`, subscriptionId: `sub_${suffix}`, status, cancelAtPeriodEnd: true, collectionPaused: false, invoiceId: `in_${suffix}`, invoiceStatus } })).data).toMatchObject({ code: "OK" });
    expect((await admin.from("billing_provider_state").select("status,invoice_status,cancel_at_period_end").eq("company_id", company.id).single()).data).toEqual({ status, invoice_status: invoiceStatus, cancel_at_period_end: true });
    for (const [index, table] of retainedTables.entries()) { const result = await admin.from(table).select("*").eq("company_id", company.id); expect(result.error).toBeNull(); expect(result.data).toEqual(retained[index]); }
    expect((await admin.from("obligations").select("id").eq("company_id", company.id)).data).toEqual([]);
  }
});
