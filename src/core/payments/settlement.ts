import type { ChainReceipt } from "../ports";

export interface SettlementExpectation {
  chainId: number;
  guardAddress: string;
  usdcAddress: string;
  onchainKey: string;
  recipient: string;
  amount: bigint;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Independent of Circle: returns mismatch reasons, empty list = full match (rule 27). */
export function matchSettlement(receipt: ChainReceipt | null, exp: SettlementExpectation): string[] {
  if (!receipt) return ["NO_RECEIPT"];
  const bad: string[] = [];
  if (receipt.chainId !== exp.chainId) bad.push("WRONG_CHAIN");
  if (!receipt.success) bad.push("TX_FAILED");
  const paid = receipt.guardEvents.filter((e) => same(e.address, exp.guardAddress) && same(e.obligationKey, exp.onchainKey));
  if (paid.length !== 1) bad.push("GUARD_EVENT_COUNT");
  else {
    if (!same(paid[0].recipient, exp.recipient)) bad.push("GUARD_RECIPIENT");
    if (paid[0].amount !== exp.amount) bad.push("GUARD_AMOUNT");
  }
  const moved = receipt.usdcTransfers.filter((t) => same(t.token, exp.usdcAddress) && same(t.to, exp.recipient));
  if (moved.length !== 1) bad.push("USDC_TRANSFER_COUNT");
  else if (moved[0].value !== exp.amount) bad.push("USDC_AMOUNT");
  return bad;
}
