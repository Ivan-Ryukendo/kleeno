import "server-only";
import { allow, clientKey } from "@/server/db/growth";
import { factsForObligation, verifyTarget } from "@/server/db/receipts";
import { x402Ledger } from "@/server/db/x402";
import { env } from "@/server/env";
import { gatewayFacilitator } from "./facilitator";
import type { Deps } from "./verify";

// The real ports for Kleeno Verify (tests pass fakes instead).
export const liveDeps = (): Deps => ({
  allow: (request) => allow("x402-verify", clientKey(request), 60, 30), // 30 calls a minute per IP, DB-backed (S36)
  sellerAddress: () => env.X402_SELLER_ADDRESS,
  target: (t) => verifyTarget(t),
  facts: factsForObligation,
  ledger: x402Ledger,
  facilitator: gatewayFacilitator,
});
