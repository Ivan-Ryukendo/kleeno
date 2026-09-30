// Deploys PayrollGuard from the approver wallet through Circle (no raw deployer key anywhere).
// owner = approver wallet, operator = agent wallet. Idempotent: does nothing once companies.guard_address is set.
import { readFileSync } from "node:fs";
import { circle, deterministicUuid, FEE, waitForCircleTx } from "@/server/circle/client";
import { assertArcChain, USDC_ADDRESS } from "@/server/arc/reader";
import { db, must } from "@/server/db/client";
import { COMPANY_ID, company, fail, wallets } from "./_lib";

async function main() {
  await assertArcChain();
  if ((await company()).guard_address) return console.log("guard already deployed:", (await company()).guard_address);
  const { approver, agent } = await wallets();
  if (!approver || !agent) fail("run setup-wallets first");

  const art = JSON.parse(readFileSync("contracts/out/PayrollGuard.sol/PayrollGuard.json", "utf8"));
  const dep = await circle().contracts.deployContract({
    name: "PayrollGuard",
    description: "Kleeno PayrollGuard",
    walletId: approver.circle_wallet_id,
    blockchain: "ARC-TESTNET",
    abiJson: JSON.stringify(art.abi),
    bytecode: art.bytecode.object,
    constructorParameters: [USDC_ADDRESS, approver.address, agent.address],
    fee: FEE,
    idempotencyKey: deterministicUuid(`deploy-guard:${COMPANY_ID}`),
  });
  const { contractId, transactionId } = dep.data ?? {};
  if (!contractId || !transactionId) throw new Error("deployment not accepted");
  await waitForCircleTx(transactionId, 300_000);
  const address = (await circle().contracts.getContract({ id: contractId })).data?.contract?.contractAddress;
  if (!address) throw new Error("no contract address yet; rerun");
  must(await db().from("companies").update({ guard_address: address }).eq("id", COMPANY_ID).select("id"), "guard save");
  console.log("PayrollGuard deployed:", address, `https://testnet.arcscan.app/address/${address}`);
}

main().catch((e) => {
  console.error("deploy-guard failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
