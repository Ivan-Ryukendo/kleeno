// Obligations are made from an approved calculation and nothing else (rules 16, 19, 21). Amount = the line's net; recipient =
// the worker's confirmed wallet. Pure: ids and on-chain keys are added by the server.
export interface ApprovedLine {
  lineId: string;
  workerId: string;
  pseudonym: string;
  net: bigint;
  wallet: string | null;
  confirmedWallet: string | null;
}

export interface ObligationDraft {
  lineId: string;
  workerId: string;
  amount: bigint;
  recipient: string;
}

export interface ObligationPlan {
  drafts: ObligationDraft[];
  /** Workers whose wallet is missing or not confirmed: nothing is created until they are fixed (fail closed). */
  blocked: { workerId: string; pseudonym: string; reason: "NO_WALLET" | "RECIPIENT_UNCONFIRMED" }[];
}

const same = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A zero-net line owes nothing, so it gets no obligation. */
export function planObligations(lines: readonly ApprovedLine[]): ObligationPlan {
  const plan: ObligationPlan = { drafts: [], blocked: [] };
  for (const l of lines) {
    if (l.net <= 0n) continue;
    if (!l.wallet) plan.blocked.push({ workerId: l.workerId, pseudonym: l.pseudonym, reason: "NO_WALLET" });
    else if (!same(l.wallet, l.confirmedWallet)) plan.blocked.push({ workerId: l.workerId, pseudonym: l.pseudonym, reason: "RECIPIENT_UNCONFIRMED" });
    else plan.drafts.push({ lineId: l.lineId, workerId: l.workerId, amount: l.net, recipient: l.wallet });
  }
  return plan;
}
