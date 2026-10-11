// Authored acceptance only. The DB config refuses every non-loopback target.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { billingAdminCommand } from "@/server/db/billing";
import { recordStripeReceipt } from "@/server/db/billing-provider";
import { admin, makeCompany, userClient } from "./helpers";

it("Stripe TEST receipts dedupe and fence current-owner reconciliation without financial authority", async () => {
  const company = await makeCompany(), foreign = await makeCompany();
  const actor = company.payroll.id, intent = randomUUID(), assignment = randomUUID(), key = randomUUID();
  const suffix = randomUUID().replaceAll("-", ""), checkout = `cs_test_${suffix}`, customer = `cus_${suffix}`, subscription = `sub_${suffix}`;
  expect((await admin.schema("growth").from("platform_admins").insert({ user_id: actor })).error).toBeNull();
  await billingAdminCommand({ userId: actor }, { action: "assign", id: assignment, companyId: company.id, expectedRevision: 0, idempotencyKey: randomUUID(), reason: "Isolated TEST billing acceptance", tierId: null, tierRevision: null, price: { name: "Fixture", baseCents: 4900, workerCents: 200 }, usageEnabled: true });
  const assignmentRow = await admin.from("billing_company_events").select("id").eq("company_id", company.id).eq("action", "assign").single();
  expect(assignmentRow.error).toBeNull();
  const start = { p_company: company.id, p_actor: actor, p_intent: intent, p_assignment: assignmentRow.data!.id, p_key: key, p_hash: "a".repeat(64) };
  const begin = () => admin.rpc("begin_stripe_test_checkout", start);
  expect((await begin()).data).toMatchObject({ code: "OK", intentId: intent });
  expect((await begin()).data).toMatchObject({ code: "OK", intentId: intent });
  expect((await admin.rpc("begin_stripe_test_checkout", { ...start, p_hash: "b".repeat(64) })).data).toMatchObject({ code: "CONFLICT" });
  expect((await admin.rpc("bind_stripe_test_checkout", { p_company: company.id, p_actor: actor, p_intent: intent, p_session: checkout })).data).toMatchObject({ code: "OK" });
  const ownerClient = await userClient(company.payroll, company.id), peerClient = await userClient(company.payment, company.id), foreignClient = await userClient(foreign.payroll, foreign.id);
  expect((await ownerClient.from("billing_provider_state").select("company_id")).data).toEqual([{ company_id: company.id }]);
  expect((await peerClient.from("billing_provider_state").select("company_id")).data).toEqual([]);
  expect((await foreignClient.from("billing_provider_state").select("company_id").eq("company_id", company.id)).data).toEqual([]);
  expect((await ownerClient.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: randomUUID() })).error).not.toBeNull();
  const token1 = randomUUID();
  const claim = await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: token1 });
  expect(claim.data).toMatchObject({ code: "OK", state: { seq: 0, intentId: intent, checkoutId: checkout } });
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: randomUUID() })).data).toMatchObject({ code: "BUSY" });
  const hint = { eventId: `evt_${suffix}`, type: "checkout.session.completed", objectId: checkout, objectType: "checkout.session" as const, customerId: customer, subscriptionId: subscription };
  const raw = Buffer.from("BILLING_RECEIPT_PRIVATE_CANARY");
  expect(await recordStripeReceipt(hint, raw)).toMatchObject({ duplicate: false, matched: true });
  expect(await recordStripeReceipt(hint, raw)).toMatchObject({ duplicate: true });
  await expect(recordStripeReceipt(hint, Buffer.from("altered bytes"))).rejects.toMatchObject({ code: "CONFLICT" });
  const observation = { intentId: intent, checkoutId: checkout, customerId: customer, subscriptionId: subscription, status: "active", cancelAtPeriodEnd: false, collectionPaused: false, invoiceId: null, invoiceStatus: null };
  const finish = (token: string, seq: number, observed = observation) => admin.rpc("finish_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: token, p_seq: seq, p_observation: observed, p_correlation: randomUUID() });
  // A signed receipt arriving while fetches were outstanding fences that observation.
  expect((await finish(token1, 0)).data).toMatchObject({ code: "CONFLICT" });
  const token2 = randomUUID();
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: token2 })).data).toMatchObject({ code: "OK", state: { seq: 1 } });
  expect((await finish(token1, 1)).data).toMatchObject({ code: "CONFLICT" });
  // Cleanup from the stale worker cannot release the replacement worker's lease.
  await admin.rpc("fail_stripe_test_reconciliation", { p_company: company.id, p_token: token1 });
  expect((await finish(token2, 1)).data).toMatchObject({ code: "OK", revision: 1 });
  const state = await admin.from("billing_provider_state").select("revision,receipt_seq,status,reconciliation_pending").eq("company_id", company.id).single();
  expect(state.data).toEqual({ revision: 1, receipt_seq: 1, status: "active", reconciliation_pending: false });
  const receipt = await admin.schema("growth").from("billing_webhook_receipts").select("*").eq("event_id", hint.eventId).single();
  expect(receipt.error).toBeNull(); expect(JSON.stringify(receipt.data)).not.toContain("PRIVATE_CANARY"); expect(receipt.data?.refs_enc).toBeTruthy();
  expect((await admin.schema("growth").from("billing_webhook_receipts").delete().eq("event_id", hint.eventId)).error).not.toBeNull();
  expect((await admin.from("billing_provider_observations").update({ status: "canceled" }).eq("company_id", company.id)).error).not.toBeNull();
  expect((await admin.from("billing_provider_state").update({ status: "active" }).eq("company_id", company.id)).error).not.toBeNull();
  expect((await admin.from("obligations").select("id").eq("company_id", company.id)).data).toEqual([]);
  expect((await admin.from("companies").select("live_payments_enabled").eq("id", company.id).single()).data?.live_payments_enabled).toBe(false);
  // Delivery order and snapshot status never overwrite current observed facts.
  const newest = { ...hint, eventId: `evt_new_${suffix}`, type: "customer.subscription.deleted", objectId: subscription, objectType: "subscription" as const };
  const older = { ...newest, eventId: `evt_old_${suffix}`, type: "customer.subscription.updated" };
  const newestRaw = Buffer.from(JSON.stringify({ created: 200, status: "canceled", private: "REORDERED_PRIVATE_CANARY" }));
  const olderRaw = Buffer.from(JSON.stringify({ created: 100, status: "active", private: "REORDERED_PRIVATE_CANARY" }));
  expect(await recordStripeReceipt(newest, newestRaw)).toMatchObject({ duplicate: false, matched: true });
  expect(await recordStripeReceipt(older, olderRaw)).toMatchObject({ duplicate: false, matched: true });
  expect(await recordStripeReceipt(newest, newestRaw)).toMatchObject({ duplicate: true });
  expect((await admin.from("billing_provider_state").select("revision,receipt_seq,status,reconciliation_pending").eq("company_id", company.id).single()).data)
    .toEqual({ revision: 1, receipt_seq: 3, status: "active", reconciliation_pending: true });
  const refreshToken = randomUUID();
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: refreshToken })).data).toMatchObject({ code: "OK", state: { seq: 3 } });
  expect((await finish(refreshToken, 3, { ...observation, status: "past_due" })).data).toMatchObject({ code: "OK", revision: 2 });
  expect((await admin.from("billing_provider_state").select("revision,receipt_seq,status,reconciliation_pending").eq("company_id", company.id).single()).data)
    .toEqual({ revision: 2, receipt_seq: 3, status: "past_due", reconciliation_pending: false });
  const reorderedReceipts = await admin.schema("growth").from("billing_webhook_receipts").select("*").in("event_id", [newest.eventId, older.eventId]);
  expect(reorderedReceipts.error).toBeNull(); expect(reorderedReceipts.data).toHaveLength(2);
  expect(JSON.stringify(reorderedReceipts.data)).not.toContain("REORDERED_PRIVATE_CANARY");
  expect(reorderedReceipts.data!.every(row => !!row.refs_enc)).toBe(true);
  expect((await admin.from("obligations").select("id").eq("company_id", company.id)).data).toEqual([]);
  expect((await admin.from("companies").select("live_payments_enabled").eq("id", company.id).single()).data?.live_payments_enabled).toBe(false);
  const token3 = randomUUID();
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: token3 })).data).toMatchObject({ code: "OK" });
  // Preserve the required active Owner while revoking the actor being reconciled.
  expect((await admin.from("memberships").update({ roles: ["OWNER", "PAYMENT_APPROVER"] }).eq("company_id", company.id).eq("user_id", company.payment.id)).error).toBeNull();
  expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", company.id).eq("user_id", actor)).error).toBeNull();
  expect((await finish(token3, 1)).data).toMatchObject({ code: "FORBIDDEN" });
  expect((await admin.rpc("claim_stripe_test_reconciliation", { p_company: company.id, p_actor: actor, p_token: randomUUID() })).data).toMatchObject({ code: "FORBIDDEN" });
  expect((await ownerClient.from("billing_provider_observations").select("id").eq("company_id", company.id)).data).toEqual([]);
});
