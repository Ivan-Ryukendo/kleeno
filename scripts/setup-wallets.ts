// Idempotent: creates the company wallet set + approver and agent wallets once, on ARC-TESTNET.
// The entity secret is registered by the user, never by this script (rule 31).
import { circle, deterministicUuid } from "@/server/circle/client";
import { db, must } from "@/server/db/client";
import { COMPANY_ID, wallets } from "./_lib";

async function main() {
  const existing = await wallets();
  if (existing.approver && existing.agent) {
    console.log("wallets already set up");
  } else {
    const set = await circle().wallets.createWalletSet({
      name: `kleeno-${COMPANY_ID.slice(-4)}`,
      idempotencyKey: deterministicUuid(`walletset:${COMPANY_ID}`),
    });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("no wallet set id");
    const res = await circle().wallets.createWallets({
      blockchains: ["ARC-TESTNET"],
      count: 2,
      walletSetId,
      accountType: "EOA",
      idempotencyKey: deterministicUuid(`wallets:${COMPANY_ID}`),
    });
    const list = res.data?.wallets ?? [];
    if (list.length !== 2) throw new Error("expected 2 wallets");
    const rows = [
      { role: "APPROVER", w: list[0] },
      { role: "AGENT", w: list[1] },
    ].map(({ role, w }) => ({ company_id: COMPANY_ID, role, circle_wallet_id: w.id, address: w.address, blockchain: "ARC-TESTNET" }));
    must(await db().from("company_wallets").upsert(rows, { onConflict: "company_id,role" }).select("id"), "wallet save");
  }
  const { approver, agent } = await wallets();
  console.log(`APPROVER (treasury, guard owner): ${approver?.address}`);
  console.log(`AGENT (guard operator):           ${agent?.address}`);
  console.log("Fund both from https://faucet.circle.com (Arc Testnet, USDC). The approver needs the batch total plus gas.");
}

main().catch((e) => {
  console.error("setup-wallets failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
