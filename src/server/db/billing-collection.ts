import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BillingCollectionSchema, closedUsageMonth, usageCharge, type BillingCollection } from "@/core/billing-collection";
import { PriceSchema } from "@/core/billing";
import { canonicalString } from "@/core/canonical";
import { WorkflowError } from "@/core/workflow";
import { fingerprint, openJson, sealJson } from "@/server/crypto";
import { buildTestCheckout, stripeBillingConfig, stripeGet, stripeSubscriptionReference, stripeWrite, type StripeBillingConfig, type StripeWritePath } from "@/server/stripe-billing";
import { db, must } from "./client";
type Owner = { companyId: string; userId: string; correlationId: string };
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const expanded = (prefix: string) => z.union([ref(prefix), z.object({ id: ref(prefix) })]).transform(value => typeof value === "string" ? value : value.id);
const PayloadSchema = z.object({ action: z.enum(["checkout", "cancel", "usage"]), intentId: z.string().uuid(), customerId: ref("cus").nullable(), subscriptionId: ref("sub").nullable(), price: PriceSchema.nullable(), amountCents: z.number().int().min(0).max(100_000_000), uniqueWorkers: z.number().int().min(0).max(10000), month: z.string().nullable(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
type Payload = z.infer<typeof PayloadSchema>;
interface CommandRow { id: string; company_id: string; actor_id: string; action: Payload["action"]; command_key: string; command_hash: string; payload_enc: string; status: string; stage: number; token: string | null; invoice_id: string | null; item_id: string | null; checkout_id: string | null; invoice_status: string | null; usage_refs: { workerId: string; assignmentId: string }[] }
async function owner(who: Owner) {
  const result = await db().from("memberships").select("roles").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("billing access unavailable");
  if (!result.data?.roles.includes("OWNER")) throw new WorkflowError("FORBIDDEN", "Current company Owner access is required");
}
function check(result: { code: string }) {
  if (result.code === "FORBIDDEN") throw new WorkflowError("FORBIDDEN", "Current company Owner access is required");
  if (result.code !== "OK") throw new WorkflowError("CONFLICT", "Billing command or evidence changed; uncertain provider writes require reconciliation");
}
async function row(who: Owner, id: string) {
  const result = await db().from("billing_collection_commands").select("*").eq("company_id", who.companyId).eq("id", id).single();
  return must(result, "billing collection command") as CommandRow;
}
async function usageRows(companyId: string, month: string) {
  const result = await db().from("billing_worker_usage").select("worker_id,assignment_id", { count: "exact" }).eq("company_id", companyId).eq("month", month).order("worker_id");
  const rows = must(result, "billing usage source");
  if (result.count !== rows.length || rows.length > 10000) throw new WorkflowError("CONFLICT", "Monthly usage source is incomplete");
  return rows.map(value => ({ workerId: String(value.worker_id), assignmentId: String(value.assignment_id) }));
}
async function usageQuote(who: Owner, month: string) {
  closedUsageMonth(month); const usage = await usageRows(who.companyId, month), prices = new Map<string, unknown>();
  for (const assignmentId of new Set(usage.map(value => value.assignmentId))) {
    const source = await db().from("billing_company_events").select("id,payload_enc").eq("company_id", who.companyId).eq("id", assignmentId).single();
    const assigned = must(source, "usage assignment price");
    prices.set(assignmentId, PriceSchema.parse((await openJson<{ price: unknown }>(who.companyId, "billing_company_events", "payload_enc", assignmentId, assigned.payload_enc)).price));
  }
  const charge = usageCharge(usage, prices), sourceHash = await fingerprint(who.companyId, { month, usage, prices: [...prices], ...charge });
  return { usage, month, ...charge, sourceHash };
}
export async function previewUsageInvoice(who: Owner, month: string) { await owner(who); const quote = await usageQuote(who, month); await owner(who); return { month: quote.month, amountCents: quote.amountCents, uniqueWorkers: quote.uniqueWorkers, sourceHash: quote.sourceHash }; }
async function prepare(who: Owner, command: BillingCollection) {
  await owner(who);
  const hash = await fingerprint(who.companyId, { actorId: who.userId, command });
  const prior = await db().from("billing_collection_commands").select("id,actor_id,command_hash").eq("company_id", who.companyId).eq("command_key", command.idempotencyKey).maybeSingle();
  if (prior.error) throw new Error("billing command retry unavailable");
  if (prior.data) {
    if (prior.data.actor_id !== who.userId || prior.data.command_hash !== hash) throw new WorkflowError("CONFLICT", "Billing retry key already records a different command");
    return row(who, prior.data.id);
  }
  const bindingResult = await db().from("billing_provider_state").select("intent_id,customer_id,subscription_id").eq("company_id", who.companyId).maybeSingle();
  if (bindingResult.error) throw new Error("billing provider binding unavailable");
  let binding = bindingResult.data;
  let price: Payload["price"] = null, amountCents = 0, uniqueWorkers = 0, sourceHash: string | null = null, usage: { workerId: string; assignmentId: string }[] = [];
  if (command.action === "checkout") {
    const terms = await db().from("billing_company_events").select("id,payload_enc,usage_enabled").eq("company_id", who.companyId).eq("action", "assign").order("revision", { ascending: false }).limit(1).maybeSingle();
    if (terms.error || !terms.data?.usage_enabled) throw new WorkflowError("CONFLICT", "An explicit billable company assignment is required");
    price = PriceSchema.parse((await openJson<{ price: unknown }>(who.companyId, "billing_company_events", "payload_enc", terms.data.id, terms.data.payload_enc)).price);
    if (price.baseCents !== command.expectedBaseCents) throw new WorkflowError("CONFLICT", "Company base price changed; review current terms before Checkout");
    const intent = must(await db().rpc("begin_stripe_test_checkout", { p_company: who.companyId, p_actor: who.userId, p_intent: randomUUID(), p_assignment: terms.data.id, p_key: command.idempotencyKey, p_hash: hash }), "billing checkout intent") as { code: string; intentId: string };
    check(intent); binding = { intent_id: intent.intentId, customer_id: null, subscription_id: null };
  } else {
    if (!binding?.customer_id || !binding.subscription_id) throw new WorkflowError("CONFLICT", "Reconcile a server-bound Stripe TEST subscription first");
    if (command.action === "usage") {
      ({ amountCents, uniqueWorkers, usage, sourceHash } = await usageQuote(who, command.month));
      if (amountCents !== command.expectedAmountCents || sourceHash !== command.expectedSourceHash) throw new WorkflowError("CONFLICT", "Monthly usage quote changed; review the closed month again");
    }
  }
  if (!binding) throw new WorkflowError("CONFLICT", "Billing intent is unavailable");
  const id = randomUUID(), payload: Payload = { action: command.action, intentId: binding.intent_id, customerId: binding.customer_id, subscriptionId: binding.subscription_id, price, amountCents, uniqueWorkers, month: command.action === "usage" ? command.month : null, sourceHash };
  await owner(who);
  const prepared = must(await db().rpc("prepare_billing_collection", { p_company: who.companyId, p_actor: who.userId, p_id: id, p_action: command.action, p_month: payload.month, p_key: command.idempotencyKey, p_hash: hash, p_payload: await sealJson(who.companyId, "billing_collection_commands", "payload_enc", id, payload), p_usage: usage }), "prepare TEST billing") as { code: string; id: string };
  check(prepared); return row(who, prepared.id);
}
const safeCheckoutUrl = (value: unknown) => { const url = z.string().url().parse(value), parsed = new URL(url); if (parsed.origin !== "https://checkout.stripe.com") throw new Error("STRIPE_INVALID_OBJECT"); return url; };
const checkoutSchema = z.object({ id: ref("cs_test"), object: z.literal("checkout.session"), mode: z.literal("subscription"), livemode: z.literal(false), currency: z.literal("usd"), amount_subtotal: z.number().int(), metadata: z.object({ kleeno_intent: z.string().uuid() }), status: z.enum(["open", "complete", "expired"]), customer: expanded("cus").nullable(), subscription: expanded("sub").nullable(), url: z.string().nullable() });
function checkoutBound(session: z.infer<typeof checkoutSchema>, payload: Payload) { return session.metadata.kleeno_intent === payload.intentId && session.amount_subtotal === payload.price?.baseCents && (!payload.customerId || session.customer === payload.customerId) && (!payload.subscriptionId || session.subscription === payload.subscriptionId); }
const invoiceSchema = z.object({ id: ref("in"), object: z.literal("invoice"), livemode: z.literal(false), customer: expanded("cus"), currency: z.literal("usd"), subscription: expanded("sub").nullable().optional(), parent: z.object({ subscription_details: z.object({ subscription: expanded("sub") }).nullable().optional() }).nullable().optional(), metadata: z.object({ kleeno_command: z.string().uuid() }), status: z.enum(["draft", "open", "paid", "void", "uncollectible"]), total: z.number().int(), lines: z.object({ has_more: z.literal(false), data: z.array(z.object({ amount: z.number().int(), metadata: z.object({ kleeno_command: z.string().uuid() }) })) }) });
const invoiceBound = (invoice: z.infer<typeof invoiceSchema>, payload: Payload, commandId: string) => invoice.customer === payload.customerId && invoice.metadata.kleeno_command === commandId && stripeSubscriptionReference(invoice) === payload.subscriptionId;
async function providerStep(command: CommandRow, payload: Payload, origin: string, config: StripeBillingConfig, fetchFn: typeof fetch) {
  const key = `${command.id}:${command.stage}`, metadata = { "metadata[kleeno_command]": command.id };
  let path: StripeWritePath, body: URLSearchParams;
  if (payload.action === "checkout") {
    if (!payload.price) throw new Error("billing price missing");
    body = buildTestCheckout({ intentId: payload.intentId, price: payload.price, successUrl: `${origin}/settings/billing`, cancelUrl: `${origin}/settings/billing` }); path = "checkout/sessions";
    const result = await stripeWrite(path, body, key, config, fetchFn);
    const session = checkoutSchema.parse(result);
    if (!checkoutBound(session, payload) || session.status !== "open") throw new Error("STRIPE_BINDING_MISMATCH");
    return { done: true, refs: { checkoutId: session.id, intentId: payload.intentId }, checkoutUrl: safeCheckoutUrl(session.url) };
  }
  if (payload.action === "cancel") {
    path = `subscriptions/${payload.subscriptionId}`; body = new URLSearchParams({ cancel_at_period_end: "true", proration_behavior: "none" });
    const result = z.object({ id: ref("sub"), object: z.literal("subscription"), livemode: z.literal(false), customer: expanded("cus"), cancel_at_period_end: z.literal(true) }).parse(await stripeWrite(path, body, key, config, fetchFn));
    if (result.id !== payload.subscriptionId || result.customer !== payload.customerId) throw new Error("STRIPE_BINDING_MISMATCH");
    return { done: true, refs: { subscriptionId: result.id }, checkoutUrl: null };
  }
  if (payload.amountCents === 0) return { done: true, refs: { invoiceStatus: "NO_CHARGE" }, checkoutUrl: null };
  if (command.stage === 0) {
    path = "invoices"; body = new URLSearchParams({ customer: payload.customerId!, subscription: payload.subscriptionId!, currency: "usd", pending_invoice_items_behavior: "exclude", auto_advance: "false", collection_method: "charge_automatically", discounts: "", ...metadata });
    const result = invoiceSchema.parse(await stripeWrite(path, body, key, config, fetchFn));
    if (!invoiceBound(result, payload, command.id) || result.status !== "draft" || result.total !== 0 || result.lines.data.length !== 0) throw new Error("STRIPE_BINDING_MISMATCH");
    return { done: false, refs: { invoiceId: result.id, invoiceStatus: result.status }, checkoutUrl: null };
  }
  if (!command.invoice_id) throw new Error("STRIPE_INVOICE_NOT_BOUND");
  if (command.stage === 1) {
    const current = invoiceSchema.parse(await stripeGet("invoices", command.invoice_id, config, fetchFn));
    if (!invoiceBound(current, payload, command.id) || current.status !== "draft" || current.total !== 0 || current.lines.data.length !== 0) throw new Error("STRIPE_BINDING_MISMATCH");
    body = new URLSearchParams({ customer: payload.customerId!, invoice: command.invoice_id, amount: String(payload.amountCents), currency: "usd", discountable: "false", description: `Reviewed-worker usage ${payload.month!.slice(0, 7)} UTC (${payload.uniqueWorkers} unique workers)`, ...metadata });
    const result = z.object({ id: ref("ii"), object: z.literal("invoiceitem"), livemode: z.literal(false), customer: expanded("cus"), invoice: ref("in"), amount: z.literal(payload.amountCents), currency: z.literal("usd"), metadata: z.object({ kleeno_command: z.literal(command.id) }) }).parse(await stripeWrite("invoiceitems", body, key, config, fetchFn));
    if (result.customer !== payload.customerId || result.invoice !== command.invoice_id) throw new Error("STRIPE_BINDING_MISMATCH");
    return { done: false, refs: { itemId: result.id }, checkoutUrl: null };
  }
  const current = invoiceSchema.parse(await stripeGet("invoices", command.invoice_id, config, fetchFn));
  if (!invoiceBound(current, payload, command.id) || current.status !== "draft" || current.total !== payload.amountCents || current.lines.data.length !== 1 || current.lines.data[0].amount !== payload.amountCents || current.lines.data[0].metadata.kleeno_command !== command.id) throw new Error("STRIPE_BINDING_MISMATCH");
  const finalized = invoiceSchema.parse(await stripeWrite(`invoices/${command.invoice_id}/finalize`, new URLSearchParams({ auto_advance: "true" }), key, config, fetchFn));
  if (finalized.id !== command.invoice_id || !invoiceBound(finalized, payload, command.id) || finalized.total !== payload.amountCents || finalized.status === "draft" || finalized.lines.data.length !== 1 || finalized.lines.data[0].amount !== payload.amountCents || finalized.lines.data[0].metadata.kleeno_command !== command.id) throw new Error("STRIPE_BINDING_MISMATCH");
  return { done: true, refs: { invoiceId: finalized.id, invoiceStatus: finalized.status }, checkoutUrl: null };
}
export async function collectStripeTest(who: Owner, raw: BillingCollection, origin: string, config: StripeBillingConfig | null = stripeBillingConfig(), fetchFn: typeof fetch = fetch) {
  const command = BillingCollectionSchema.parse(raw);
  if (!config) throw new WorkflowError("CONFLICT", "Stripe TEST setup is unconfigured");
  if (new URL(origin).protocol !== "https:") throw new WorkflowError("CONFLICT", "Checkout requires the configured HTTPS site origin");
  let current = await prepare(who, command);
  const payload = PayloadSchema.parse(await openJson(who.companyId, "billing_collection_commands", "payload_enc", current.id, current.payload_enc));
  await owner(who);
  if (payload.action !== command.action) throw new WorkflowError("CONFLICT", "Billing command evidence changed");
  let checkoutUrl: string | null = null;
  for (let step = 0; step < 3; step++) {
    if (current.status === "DONE") {
      if (current.action === "checkout" && current.checkout_id) {
        const session = checkoutSchema.parse(await stripeGet("checkout/sessions", current.checkout_id, config, fetchFn));
        const bindingResult = await db().from("billing_provider_state").select("customer_id,subscription_id").eq("company_id", who.companyId).single();
        const binding = must(bindingResult, "Checkout replay binding");
        if (!checkoutBound(session, { ...payload, customerId: binding.customer_id ?? null, subscriptionId: binding.subscription_id ?? null })) throw new WorkflowError("CONFLICT", "Checkout binding changed");
        checkoutUrl = session.status === "open" ? safeCheckoutUrl(session.url) : null;
      }
      break;
    }
    const token = randomUUID();
    const claimed = must(await db().rpc("claim_billing_collection", { p_company: who.companyId, p_actor: who.userId, p_id: current.id, p_token: token }), "claim TEST billing") as { code: string; stage?: number };
    check(claimed);
    if (claimed.stage !== current.stage) throw new WorkflowError("CONFLICT", "Billing command stage changed");
    try {
      await owner(who);
      const observed = await providerStep(current, payload, origin, config, fetchFn);
      const finished = must(await db().rpc("finish_billing_collection", { p_company: who.companyId, p_actor: who.userId, p_id: current.id, p_token: token, p_stage: current.stage, p_refs: observed.refs, p_done: observed.done, p_correlation: who.correlationId }), "commit TEST billing") as { code: string };
      check(finished); checkoutUrl = observed.checkoutUrl;
      current = await row(who, current.id);
      if (current.status === "DONE") break;
    } catch (caught) {
      await db().rpc("mark_billing_collection_unknown", { p_company: who.companyId, p_actor: who.userId, p_id: current.id, p_token: token });
      if (caught instanceof WorkflowError && caught.code === "FORBIDDEN") throw caught;
      throw new WorkflowError("CONFLICT", "Stripe TEST write outcome requires reconciliation. No automatic retry or new billing command is safe.");
    }
  }
  await owner(who);
  return { id: current.id, action: current.action, status: current.status, checkoutUrl, invoiceId: current.invoice_id, invoiceStatus: current.invoice_status, entitlement: "UNCONFIGURED" };
}
/** Read current exact provider objects to resolve an uncertain write. This never sends a provider mutation. */
export async function reconcileCollectionCommand(who: Owner, commandId: string, objectId: string, config: StripeBillingConfig | null = stripeBillingConfig(), fetchFn: typeof fetch = fetch) {
  z.string().uuid().parse(commandId); await owner(who);
  if (!config) throw new WorkflowError("CONFLICT", "Stripe TEST setup is unconfigured");
  const current = await row(who, commandId);
  if (!["UNKNOWN", "IN_FLIGHT"].includes(current.status) || !current.token) throw new WorkflowError("CONFLICT", "Only an uncertain provider write can be reconciled");
  const payload = PayloadSchema.parse(await openJson(who.companyId, "billing_collection_commands", "payload_enc", commandId, current.payload_enc));
  let refs: Record<string, string>, done = true;
  if (payload.action === "checkout") {
    const session = checkoutSchema.parse(await stripeGet("checkout/sessions", objectId, config, fetchFn));
    if (!checkoutBound(session, payload)) throw new WorkflowError("CONFLICT", "Provider Checkout does not match the pinned intent and amount");
    refs = { checkoutId: session.id, intentId: payload.intentId };
  } else if (payload.action === "cancel") {
    if (objectId !== payload.subscriptionId) throw new WorkflowError("CONFLICT", "Only the server-bound subscription can be reconciled");
    const subscription = z.object({ id: ref("sub"), customer: expanded("cus"), cancel_at_period_end: z.literal(true) }).parse(await stripeGet("subscriptions", objectId, config, fetchFn));
    if (subscription.customer !== payload.customerId) throw new WorkflowError("CONFLICT", "Subscription customer binding changed");
    refs = { subscriptionId: subscription.id };
  } else if (current.stage === 1) {
    const item = z.object({ id: ref("ii"), customer: expanded("cus"), invoice: ref("in"), currency: z.literal("usd"), amount: z.literal(payload.amountCents), metadata: z.object({ kleeno_command: z.literal(commandId) }) }).parse(await stripeGet("invoiceitems", objectId, config, fetchFn));
    if (item.customer !== payload.customerId || item.invoice !== current.invoice_id) throw new WorkflowError("CONFLICT", "Invoice item binding changed");
    refs = { itemId: item.id }; done = false;
  } else {
    if (current.stage === 2 && objectId !== current.invoice_id) throw new WorkflowError("CONFLICT", "Only the bound usage invoice can be reconciled");
    const invoice = invoiceSchema.parse(await stripeGet("invoices", objectId, config, fetchFn));
    if (!invoiceBound(invoice, payload, commandId)) throw new WorkflowError("CONFLICT", "Usage invoice binding changed");
    if (current.stage === 0) {
      if (invoice.status !== "draft" || invoice.total !== 0 || invoice.lines.data.length !== 0) throw new WorkflowError("CONFLICT", "Unexpected draft invoice content");
      done = false;
    } else if (invoice.status === "draft" || invoice.total !== payload.amountCents || invoice.lines.data.length !== 1 || invoice.lines.data[0].amount !== payload.amountCents || invoice.lines.data[0].metadata.kleeno_command !== commandId) throw new WorkflowError("CONFLICT", "Finalized invoice does not match frozen usage");
    refs = { invoiceId: invoice.id, invoiceStatus: invoice.status };
  }
  await owner(who);
  const result = must(await db().rpc("finish_billing_collection", { p_company: who.companyId, p_actor: who.userId, p_id: commandId, p_token: current.token, p_stage: current.stage, p_refs: refs, p_done: done, p_correlation: who.correlationId }), "reconcile TEST billing write") as { code: string };
  check(result);
  return { id: commandId, status: done ? "DONE" : "READY", entitlement: "UNCONFIGURED" };
}
export async function loadBillingCollection(companyId: string, checkAccess: () => Promise<void>) {
  await checkAccess();
  const result = await db().from("billing_collection_commands").select("*", { count: "exact" }).eq("company_id", companyId).order("created_at", { ascending: false }).limit(100);
  const commands = must(result, "billing collection history") as CommandRow[];
  if (result.count !== commands.length) throw new WorkflowError("CONFLICT", "Billing command history exceeds the supported view");
  const summaries = [];
  for (const command of commands) {
    const payload = PayloadSchema.parse(await openJson(companyId, "billing_collection_commands", "payload_enc", command.id, command.payload_enc));
    const currentUsage = payload.month ? await usageRows(companyId, payload.month) : [];
    const usageMatches = command.action !== "usage" || canonicalString(currentUsage) === canonicalString(command.usage_refs);
    summaries.push({ id: command.id, action: command.action, idempotencyKey: command.command_key, stage: command.stage, status: command.status, month: payload.month, sourceHash: payload.sourceHash, amountCents: command.action === "checkout" ? payload.price?.baseCents ?? null : command.action === "usage" ? payload.amountCents : null, uniqueWorkers: payload.uniqueWorkers, invoiceId: command.invoice_id, invoiceStatus: command.invoice_status, checkoutId: command.checkout_id, usageReconciliation: usageMatches ? "MATCHED" : "UNRECONCILED_LATE_USAGE" });
  }
  await checkAccess(); return summaries;
}
