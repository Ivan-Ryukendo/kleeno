// Idempotent: creates the approver and agent wallets of the dev company once, on ARC-TESTNET. The same code runs in the app
// after the platform admin approves a company's live payments. The entity secret is registered by the user, never here (rule 31).
import { provisionWallets } from "@/server/circle/provisioning";
import { COMPANY_ID } from "./_lib";

async function main() {
  const { approver, agent } = await provisionWallets(COMPANY_ID);
  console.log(`APPROVER (treasury, guard owner): ${approver.address}`);
  console.log(`AGENT (guard operator):           ${agent.address}`);
  console.log("Fund both from https://faucet.circle.com (Arc Testnet, USDC). The approver needs the batch total plus gas.");
}

main().catch((e) => {
  console.error("setup-wallets failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
