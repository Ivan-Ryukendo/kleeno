// Prints approver/agent USDC (ERC-20, 6 dp) and native gas balance (18 dp) on Arc testnet.
import { erc20Abi, formatUnits, type Address } from "viem";
import { arcClient, assertArcChain, USDC_ADDRESS } from "@/server/arc/reader";
import { formatUsdc } from "@/core/money";
import { wallets } from "./_lib";

async function main() {
  const client = arcClient();
  await assertArcChain(client);
  const { approver, agent } = await wallets();
  for (const [name, w] of [["APPROVER", approver], ["AGENT", agent]] as const) {
    if (!w) {
      console.log(`${name}: not set up`);
      continue;
    }
    const usdc = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [w.address as Address] });
    const gas = await client.getBalance({ address: w.address as Address });
    console.log(`${name} ${w.address}  USDC ${formatUsdc(usdc)}  native ${formatUnits(gas, 18)}`);
  }
}

main().catch((e) => {
  console.error("check-balances failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
