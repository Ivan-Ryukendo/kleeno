// Deploys PayrollGuard from the approver wallet through Circle (no raw deployer key anywhere).
// owner = approver wallet, operator = agent wallet. Idempotent: does nothing once companies.guard_address is set.
import { assertArcChain } from "@/server/arc/reader";
import { provisionGuard } from "@/server/circle/provisioning";
import { COMPANY_ID } from "./_lib";

async function main() {
  await assertArcChain();
  const address = await provisionGuard(COMPANY_ID);
  console.log("PayrollGuard:", address, `https://testnet.arcscan.app/address/${address}`);
}

main().catch((e) => {
  console.error("deploy-guard failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
