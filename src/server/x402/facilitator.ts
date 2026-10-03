import "server-only";
import type { PaymentPayload, PaymentRequirements } from "@/core/x402";

// Circle's Gateway facilitator verifies the buyer's signed authorization and settles it from the buyer's Gateway balance
// (POST /v1/x402/settle, documented in the Nanopayments seller quickstart). Arc testnet only (rule 29), so the testnet host is fixed.
// We never verify signatures ourselves. Failures become a plain "not settled": raw responses are never logged or returned (rule 31).
const GATEWAY_API = "https://gateway-api-testnet.circle.com";

export interface SettleResult {
  success: boolean;
  payer?: string;
  transaction?: string;
}

export interface Facilitator {
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

export const gatewayFacilitator: Facilitator = {
  async settle(payload, requirements) {
    const res = await fetch(`${GATEWAY_API}/v1/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as { success?: unknown; payer?: unknown; transaction?: unknown } | null;
    return { success: data?.success === true, payer: typeof data?.payer === "string" ? data.payer : undefined, transaction: typeof data?.transaction === "string" ? data.transaction : undefined };
  },
};
