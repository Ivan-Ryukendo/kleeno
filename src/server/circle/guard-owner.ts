import "server-only";
import { keccak256, toHex } from "viem";
import { circle, deterministicUuid, FEE, waitForCircleTx } from "./client";

// The ONLY caller of PayrollGuard owner functions (S04): openRun, closeRun (and replaceOperator when needed).
// Imported only by batch authorization / close and scripts/.
// Owner = approver wallet. The obligation set comes from the DB, never from a request.

interface Owner {
  approverWalletId: string;
  guardAddress: string;
  usdcAddress: string;
}

export const guardRunKey = (batchId: string) => keccak256(toHex(batchId));

async function exec(o: Owner, contract: string, sig: string, params: unknown[], seed: string) {
  const res = await circle().wallets.createContractExecutionTransaction({
    walletId: o.approverWalletId,
    contractAddress: contract,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: FEE,
    idempotencyKey: deterministicUuid(seed), // a retried step is exactly-once
  });
  const id = res.data?.id;
  if (!id) throw new Error("circle returned no transaction id");
  return waitForCircleTx(id);
}

/** Exact approve (never unlimited), then openRun committing the batch's obligations. */
export async function openRun(
  o: Owner,
  batchId: string,
  obligations: { onchainKey: string; recipient: string; amount: bigint }[],
) {
  const total = obligations.reduce((s, x) => s + x.amount, 0n);
  await exec(o, o.usdcAddress, "approve(address,uint256)", [o.guardAddress, total.toString()], `approve:${batchId}`);
  return exec(
    o,
    o.guardAddress,
    "openRun(bytes32,bytes32[],address[],uint256[])",
    [
      guardRunKey(batchId),
      obligations.map((x) => x.onchainKey),
      obligations.map((x) => x.recipient),
      obligations.map((x) => x.amount.toString()),
    ],
    `openRun:${batchId}`,
  );
}

export function closeRun(o: Owner, batchId: string) {
  return exec(o, o.guardAddress, "closeRun(bytes32)", [guardRunKey(batchId)], `closeRun:${batchId}`);
}
