import { NextResponse } from "next/server";
import { openRoute } from "@/server/auth/guard";
import { recordStripeReceipt } from "@/server/db/billing-provider";
import { parseStripeHint, readWebhookBody, stripeBillingConfig, verifyStripeSignature } from "@/server/stripe-billing";
export const POST = openRoute({ serverToServer: true }, async ({ request }) => {
  const config = stripeBillingConfig();
  if (!config) return NextResponse.json({ error: { code: "UNCONFIGURED", message: "Stripe TEST webhook is unavailable" } }, { status: 503 });
  let raw: Buffer;
  try { raw = await readWebhookBody(request); } catch { return NextResponse.json({ error: { code: "TOO_LARGE", message: "Request too large" } }, { status: 413 }); }
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), config.webhookSecret)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid provider signature" } }, { status: 401 });
  let hint;
  try { hint = parseStripeHint(raw); } catch { return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Unsupported Stripe TEST event" } }, { status: 400 }); }
  // Durable signed hints only. An Owner explicitly reconciles current provider facts; snapshots grant no authority.
  return recordStripeReceipt(hint, raw);
});
