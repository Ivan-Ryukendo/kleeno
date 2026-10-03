import "server-only";
import { createPublicClient, decodeEventLog, http, parseAbi, parseAbiItem, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import type { ChainReader, ChainReceipt } from "@/core/ports";
import { guardAbi } from "./guard-abi";

export const ARC_CHAIN_ID = 5042002;
// ERC-20 USDC on Arc: 6 decimals. The native gas token is 18 decimals; never mix (rule 29).
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const EXPLORER_TX = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export function arcClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
}

/** S39: the RPC must report chain 5042002 before any payment path runs. */
export async function assertArcChain(client = arcClient()) {
  const id = await client.getChainId();
  if (id !== ARC_CHAIN_ID) throw new Error(`RPC reports chain ${id}, expected ${ARC_CHAIN_ID}`);
}

const paidEvent = parseAbiItem("event ObligationPaid(bytes32 indexed runKey, bytes32 indexed obligationKey, address recipient, uint256 amount)");
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** USDC (6 dp) held by an address on Arc. */
export async function usdcBalanceOf(address: string, client = arcClient()): Promise<bigint> {
  await assertArcChain(client);
  return client.readContract({ address: USDC_ADDRESS, abi: erc20, functionName: "balanceOf", args: [address as Address] });
}

export function arcChainReader(guardAddress: string, client = arcClient()): ChainReader {
  const guard = guardAddress as Address;
  const read = <F extends "entries" | "runs" | "isPaid">(functionName: F, args: [Hex]) =>
    client.readContract({ address: guard, abi: guardAbi, functionName, args } as never) as Promise<unknown>;

  return {
    async guardEntry(onchainKey) {
      await assertArcChain(client);
      const [runKey, recipient, amount, paid] = (await read("entries", [onchainKey as Hex])) as [Hex, Address, bigint, boolean];
      if (/^0x0+$/.test(runKey)) return { committed: false, runOpen: false, paid: false, runKey, recipient, amount };
      const [, open] = (await read("runs", [runKey])) as [boolean, boolean, bigint];
      return { committed: true, runOpen: open, paid, runKey, recipient, amount };
    },
    async isPaid(onchainKey) {
      return (await read("isPaid", [onchainKey as Hex])) as boolean;
    },
    async paymentTx(onchainKey) {
      // The key is an indexed topic, so this is a cheap filtered log query. An RPC that refuses the range returns null: recovery then fails closed.
      try {
        const logs = await client.getLogs({ address: guard, event: paidEvent, args: { obligationKey: onchainKey as Hex }, fromBlock: 0n });
        return logs.length === 1 ? logs[0].transactionHash : null;
      } catch {
        return null;
      }
    },
    async receipt(txHash): Promise<ChainReceipt | null> {
      const chainId = await client.getChainId(); // reported by the RPC, matched in settlement
      let r;
      try {
        r = await client.getTransactionReceipt({ hash: txHash as Hex });
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null; // not indexed yet
        throw e; // an RPC failure is not "no receipt"; the agent keeps polling
      }
      const guardEvents: ChainReceipt["guardEvents"] = [];
      const usdcTransfers: ChainReceipt["usdcTransfers"] = [];
      for (const log of r.logs) {
        // Only the USDC ERC-20 address counts; the 18-dp system transfer comes from another address (rule 29).
        if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
          try {
            const e = decodeEventLog({ abi: [transfer], data: log.data, topics: log.topics });
            usdcTransfers.push({ token: log.address, to: e.args.to, value: e.args.value });
          } catch {
            /* not a Transfer */
          }
        } else if (log.address.toLowerCase() === guard.toLowerCase()) {
          try {
            const e = decodeEventLog({ abi: guardAbi, data: log.data, topics: log.topics });
            if (e.eventName === "ObligationPaid") {
              guardEvents.push({
                address: log.address,
                obligationKey: e.args.obligationKey,
                recipient: e.args.recipient,
                amount: e.args.amount,
              });
            }
          } catch {
            /* other guard event */
          }
        }
      }
      return { chainId, success: r.status === "success", guardEvents, usdcTransfers };
    },
  };
}
