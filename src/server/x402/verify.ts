import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatUsdc } from "@/core/money";
import type { ReceiptFacts } from "@/core/receipt";
import { checkPayment, paymentRequiredHeader, paymentRequirements, verifyAnswer, X402_NETWORK, X402_PRICE } from "@/core/x402";
import type { Ledger } from "@/server/db/x402";
import type { Facilitator } from "./facilitator";

// Kleeno Verify (S68). The route is a thin wrapper around this (wiring in ./live.ts): everything that can fail is a port, so tests run with fakes and no network.
// Order matters: nothing about a payment is read before the price is paid, and the buyer is never charged for a lookup that finds nothing.
//   no payment header -> 402 (no lookup at all) | header checked against the price | target looked up | ledger row | facilitator settles | answer.
export interface Deps {
  /** Per-IP rate limit (S36, S68): true = allowed. */
  allow(request: Request): Promise<boolean>;
  sellerAddress(): string | undefined;
  target(t: { receipt: string } | { obligation: string }): Promise<{ obligationId: string; companyId: string } | null>;
  facts(obligationId: string): Promise<ReceiptFacts>;
  ledger: Ledger;
  facilitator: Facilitator;
}

const Query = z.union([z.object({ receipt: z.string().min(1).max(300) }).strict(), z.object({ obligation: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict()]);
const noStore = { "cache-control": "no-store" };
const fail = (status: number, code: string, extra: Record<string, string> = {}) => NextResponse.json({ error: { code } }, { status, headers: { ...noStore, ...extra } });

export async function handleVerify(request: Request, deps: Deps): Promise<Response> {
  if (!(await deps.allow(request))) return fail(429, "THROTTLED");
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return fail(400, "BAD_REQUEST");
  const seller = deps.sellerAddress();
  if (!seller) return fail(503, "NOT_CONFIGURED"); // fail closed: no receive address, no sales
  const requirements = paymentRequirements(seller);
  const required = { "payment-required": paymentRequiredHeader(request.url, requirements) };
  const header = request.headers.get("payment-signature");
  if (!header) return fail(402, "PAYMENT_REQUIRED", required);

  const paid = checkPayment(header, requirements);
  if (!paid.ok) return fail(402, paid.reason, required);
  const target = await deps.target(query.data);
  if (!target) return fail(404, "NOT_FOUND"); // nothing was settled
  if ((await deps.ledger.begin({ companyId: target.companyId, obligationId: target.obligationId, nonce: paid.nonce, payer: paid.payer, amount: X402_PRICE })) === "REPLAY") return fail(402, "PAYMENT_ALREADY_USED");

  let settled: Awaited<ReturnType<Facilitator["settle"]>>;
  try {
    settled = await deps.facilitator.settle(paid.payload, requirements);
  } catch {
    settled = { success: false };
  }
  if (!settled.success) {
    await deps.ledger.finish(paid.nonce, { status: "FAILED" });
    return fail(402, "SETTLEMENT_FAILED", required);
  }
  await deps.ledger.finish(paid.nonce, { status: "SETTLED", ref: settled.transaction, payer: settled.payer });
  const answer = verifyAnswer(await deps.facts(target.obligationId), formatUsdc);
  const receipt = Buffer.from(JSON.stringify({ success: true, transaction: settled.transaction ?? null, network: X402_NETWORK, payer: settled.payer ?? paid.payer })).toString("base64");
  return NextResponse.json(answer, { headers: { ...noStore, "payment-response": receipt } });
}
