import "server-only";
import { createHash } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
import { z } from "zod";

// Read lazily: the app boots without Circle vars; payment paths and scripts need them.
const circleEnv = z.object({
  CIRCLE_API_KEY: z.string().startsWith("TEST_API_KEY:", "only a Circle TEST_API_KEY is accepted"),
  CIRCLE_ENTITY_SECRET: z.string().regex(/^[0-9a-f]{64}$/i, "entity secret must be 32 bytes of hex"),
});

let cached: ReturnType<typeof build> | undefined;

function build() {
  const parsed = circleEnv.safeParse(process.env);
  if (!parsed.success) {
    // names + our own messages only; never echo the values
    throw new Error(`Circle env invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`);
  }
  const cfg = { apiKey: parsed.data.CIRCLE_API_KEY, entitySecret: parsed.data.CIRCLE_ENTITY_SECRET };
  return { wallets: initiateDeveloperControlledWalletsClient(cfg), contracts: initiateSmartContractPlatformClient(cfg) };
}

export function circle() {
  return (cached ??= build());
}

/** Stable UUID-v4-shaped idempotency key derived from a seed, so a retried setup step is exactly-once. */
export function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const FEE = { type: "level", config: { feeLevel: "MEDIUM" } } as const;

const TERMINAL_OK = new Set(["COMPLETE"]);
const TERMINAL_FAIL = new Set(["FAILED", "DENIED", "CANCELLED"]);

/** Poll a Circle transaction to a terminal state. Throws on failure or timeout (caller treats timeout as UNKNOWN). */
export async function waitForCircleTx(id: string, timeoutMs = 120_000): Promise<{ txHash: string }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const tx = (await circle().wallets.getTransaction({ id })).data?.transaction;
    if (tx && TERMINAL_OK.has(tx.state) && tx.txHash) return { txHash: tx.txHash };
    if (tx && TERMINAL_FAIL.has(tx.state)) throw new Error(`circle transaction ${tx.state}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("circle transaction timeout");
}
