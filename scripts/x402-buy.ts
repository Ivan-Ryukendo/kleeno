// Demo buyer for Kleeno Verify (S68, P4 decision 5). Pays the x402 price from a Circle developer-controlled wallet's Gateway balance.
// No raw private key anywhere (rule 31): the EIP-3009 authorization is signed with Circle wallet typed-data signing, through the
// signer interface of Circle's own BatchEvmScheme. Needs a Circle EOA wallet on ARC-TESTNET that holds USDC (Gateway rejects smart accounts).
//
//   npm run script -- scripts/x402-buy.ts --deposit 1                       one-time: approve + deposit 1 USDC into the Gateway Wallet
//   npm run script -- scripts/x402-buy.ts --url "<.../api/x402/verify?obligation=0x...>"
//
// Env (names only here): X402_BUYER_WALLET_ID, X402_BUYER_ADDRESS (a throwaway demo wallet, never a company wallet), CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET.
// Testnet only. Moves test USDC only when you run it. Not run by CI; the live path is unverified (docs/security.md S68).
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { parseUsdc } from "@/core/money";
import { ARC, GATEWAY_WALLET } from "@/core/gateway";
import { X402_NETWORK } from "@/core/x402";
import { circle, deterministicUuid, FEE, waitForCircleTx } from "@/server/circle/client";
import { fail } from "./_lib";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const walletId = process.env.X402_BUYER_WALLET_ID ?? fail("X402_BUYER_WALLET_ID is not set");
const address = (process.env.X402_BUYER_ADDRESS ?? fail("X402_BUYER_ADDRESS is not set")) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(address)) fail("X402_BUYER_ADDRESS is not an address");

const signer = {
  address,
  async signTypedData(p: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }) {
    const data = JSON.stringify(
      {
        types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...p.types },
        domain: p.domain,
        primaryType: p.primaryType,
        message: p.message,
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    const sig = (await circle().wallets.signTypedData({ walletId, data })).data?.signature;
    if (!sig) throw new Error("Circle returned no signature");
    return sig as `0x${string}`;
  },
};

async function deposit(amountText: string) {
  const amount = parseUsdc(amountText).toString();
  if (BigInt(amount) > 5_000_000n) fail("this demo script deposits at most 5 USDC");
  const send = async (contract: string, abiFunctionSignature: string, abiParameters: unknown[], step: string) => {
    const tx = await circle().wallets.createContractExecutionTransaction({ walletId, contractAddress: contract, abiFunctionSignature, abiParameters, fee: FEE, idempotencyKey: deterministicUuid(`x402-buyer:${walletId}:${step}:${amount}:${Date.now() >> 20}`) });
    if (!tx.data?.id) throw new Error("no transaction id");
    return waitForCircleTx(tx.data.id, 300_000);
  };
  console.log(`Approving ${amountText} USDC for the Gateway Wallet on Arc testnet...`);
  await send(ARC.usdc, "approve(address,uint256)", [GATEWAY_WALLET, amount], "approve");
  console.log("Depositing...");
  const { txHash } = await send(GATEWAY_WALLET, "deposit(address,uint256)", [ARC.usdc, amount], "deposit");
  console.log(`Deposited. tx ${txHash}. The Gateway balance can take a short while to show.`);
}

async function pay(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.hostname !== "localhost") fail("use an https URL (or localhost)");
  const first = await fetch(url);
  if (first.status !== 402) return console.log(first.status, await first.text());
  const required = JSON.parse(Buffer.from(first.headers.get("payment-required") ?? "", "base64").toString()) as { x402Version: number; resource?: unknown; accepts: { network: string; amount: string; payTo: string }[] };
  const accepted = required.accepts.find((a) => a.network === X402_NETWORK);
  if (!accepted) fail("the seller does not accept Arc testnet");
  if (BigInt(accepted.amount) > 50_000n) fail("refusing to pay more than 0.05 USDC");
  console.log(`Paying ${accepted.amount} micro-USDC to ${accepted.payTo} ...`);
  const created = await new BatchEvmScheme(signer).createPaymentPayload(required.x402Version, accepted as never);
  const header = Buffer.from(JSON.stringify({ ...created, resource: required.resource, accepted })).toString("base64");
  const res = await fetch(url, { headers: { "payment-signature": header } });
  console.log(res.status, await res.text());
}

async function main() {
  const amount = arg("--deposit");
  if (amount) return deposit(amount);
  const url = arg("--url");
  if (!url) fail('usage: --deposit <usdc> | --url "<kleeno verify url>"');
  return pay(url);
}

main().catch((e) => {
  console.error("x402-buy failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
