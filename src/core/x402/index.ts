import { z } from "zod";
import type { ReceiptFacts } from "../receipt";

// Kleeno Verify (S68): a read-only answer sold for a fixed price over x402, settled by Circle's Gateway facilitator on Arc testnet.
// Pure: building the 402, checking a payment header against it, and the allow-listed answer. No network and no database here.
export const X402_NETWORK = "eip155:5042002"; // Arc testnet (rule 29)
export const X402_USDC = "0x3600000000000000000000000000000000000000"; // ERC-20 USDC on Arc, 6 decimals
export const X402_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"; // Gateway Wallet, the signing domain's verifying contract (testnet)
export const X402_PRICE = 10_000n; // $0.01 in micro-USDC
const MAX_TIMEOUT_SECONDS = 604_900; // Gateway needs authorizations valid for more than 7 days

export interface PaymentRequirements {
  scheme: "exact";
  network: typeof X402_NETWORK;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: "GatewayWalletBatched"; version: "1"; verifyingContract: string };
}

export function paymentRequirements(sellerAddress: string): PaymentRequirements {
  return { scheme: "exact", network: X402_NETWORK, asset: X402_USDC, amount: X402_PRICE.toString(), payTo: sellerAddress, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: X402_GATEWAY_WALLET } };
}

/** The base64 JSON for the `PAYMENT-REQUIRED` header of a 402. */
export function paymentRequiredHeader(resourceUrl: string, requirements: PaymentRequirements): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: resourceUrl, description: "Kleeno Verify: settlement status of one payment", mimeType: "application/json" }, accepts: [requirements] })).toString("base64");
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const PaymentHeader = z.object({
  x402Version: z.number().int(),
  accepted: z.object({ network: z.string().optional() }).passthrough().optional(),
  payload: z.object({
    signature: z.string().min(1).max(1000),
    authorization: z.object({ from: address, to: address, value: z.string().regex(/^\d{1,30}$/), validAfter: z.string(), validBefore: z.string(), nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  }).passthrough(),
}).passthrough();
export type PaymentPayload = z.infer<typeof PaymentHeader>;

export type PaymentCheck = { ok: true; payload: PaymentPayload; payer: string; nonce: string } | { ok: false; reason: "MALFORMED" | "WRONG_AMOUNT" | "WRONG_RECIPIENT" | "WRONG_NETWORK" };

/** Decodes a `PAYMENT-SIGNATURE` header and checks it against our requirements before anything is sent to the facilitator. */
export function checkPayment(header: string, requirements: PaymentRequirements): PaymentCheck {
  if (header.length > 8192) return { ok: false, reason: "MALFORMED" };
  let parsed;
  try {
    parsed = PaymentHeader.safeParse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (!parsed.success) return { ok: false, reason: "MALFORMED" };
  const { payload } = parsed.data;
  const a = payload.authorization;
  if (parsed.data.accepted?.network && parsed.data.accepted.network !== requirements.network) return { ok: false, reason: "WRONG_NETWORK" };
  if (a.value !== requirements.amount) return { ok: false, reason: "WRONG_AMOUNT" }; // exactly the price: neither less nor more
  if (a.to.toLowerCase() !== requirements.payTo.toLowerCase()) return { ok: false, reason: "WRONG_RECIPIENT" };
  return { ok: true, payload: parsed.data, payer: a.from.toLowerCase(), nonce: a.nonce.toLowerCase() };
}

/** The ONLY fields a paid answer may contain (S68). Built field by field, never by spreading a row. */
export interface VerifyAnswer {
  settled: boolean;
  status: string;
  netAmountUsdc: string;
  txHash: string | null;
  chain: "arc-testnet";
  matchesApproved: boolean;
}
export const VERIFY_ANSWER_FIELDS = ["settled", "status", "netAmountUsdc", "txHash", "chain", "matchesApproved"] as const;

export function verifyAnswer(f: ReceiptFacts, formatUsdc: (v: bigint) => string): VerifyAnswer {
  return { settled: f.status === "SETTLED", status: f.status, netAmountUsdc: formatUsdc(f.amount), txHash: f.txHash, chain: "arc-testnet", matchesApproved: f.matchesApproved };
}
