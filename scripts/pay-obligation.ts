// Runs the payment agent for one obligation ID (scripts/localhost only in P1, rule 41).
// Usage: npm run script -- scripts/pay-obligation.ts <obligationId>
import { payObligation } from "@/core/payments/agent";
import { ARC_CHAIN_ID, arcChainReader, assertArcChain, EXPLORER_TX, USDC_ADDRESS } from "@/server/arc/reader";
import { paymentsRepo } from "@/server/db/payments-repo";
import { arcUsdcRail } from "@/server/rails/arc-usdc-rail";
import { company, fail, wallets } from "./_lib";

async function main() {
  const id = process.argv[2];
  if (!id) fail("usage: pay-obligation.ts <obligationId>");
  const co = await company();
  const { agent } = await wallets();
  if (!co.guard_address || !agent) fail("guard or agent wallet missing");
  await assertArcChain();
  const out = await payObligation(id, {
    repo: paymentsRepo(),
    chain: arcChainReader(co.guard_address),
    rail: arcUsdcRail({ agentWalletId: agent.circle_wallet_id, guardAddress: co.guard_address }),
    clock: { now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    expect: { chainId: ARC_CHAIN_ID, guardAddress: co.guard_address, usdcAddress: USDC_ADDRESS },
  });
  console.log(out);
  if (out.status === "SETTLED") console.log("arcscan:", EXPLORER_TX(out.txHash));
}

main().catch((e) => {
  console.error("pay-obligation failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
