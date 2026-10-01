import "server-only";
import { circle, deterministicUuid } from "./client";

/**
 * One Circle wallet per worker on ARC-TESTNET (custodial, stated openly). Both Circle calls use idempotency keys
 * derived from the company and worker, so a retry or a race creates exactly one wallet (S26).
 */
export async function createWorkerWallet(companyId: string, workerId: string): Promise<{ walletId: string; address: string }> {
  const set = await circle().wallets.createWalletSet({ name: `kleeno-workers-${companyId.slice(-4)}`, idempotencyKey: deterministicUuid(`workerset:${companyId}`) });
  const walletSetId = set.data?.walletSet?.id;
  if (!walletSetId) throw new Error("no worker wallet set");
  const res = await circle().wallets.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    accountType: "EOA",
    idempotencyKey: deterministicUuid(`worker-wallet:${companyId}:${workerId}`),
  });
  const w = res.data?.wallets?.[0];
  if (!w) throw new Error("no worker wallet");
  return { walletId: w.id, address: w.address };
}
