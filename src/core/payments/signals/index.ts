// Deterministic payment signals (ARCHITECTURE 14.7). They never block by themselves: a fired signal forces a human
// signature (no standing authorization, rule 25) and is shown beside the plan. Pure; history comes from settled obligations.
export type SignalCode = "AMOUNT_RATIO" | "RECIPIENT_CHANGED" | "FIRST_PAYMENT" | "CONFIG_VERSION_CHANGED";

export interface Signal {
  id: string; // stable, so a plan can cite it and validation can check it fired
  code: SignalCode;
  obligationId: string | null; // null = about the whole run
}

export interface SignalObligation {
  id: string;
  workerId: string;
  amount: bigint;
  recipient: string;
}

export interface PastPayment {
  amount: bigint;
  recipient: string;
}

export interface SignalInput {
  obligations: readonly SignalObligation[];
  /** Settled payments per worker, newest first. */
  history: ReadonlyMap<string, readonly PastPayment[]>;
  configVersion: number;
  /** Config version of the company's previous settled run; null when there is none. */
  previousConfigVersion: number | null;
}

const WINDOW = 3; // the last three settled payments

export function computeSignals(i: SignalInput): Signal[] {
  const out: Signal[] = [];
  for (const o of i.obligations) {
    const past = i.history.get(o.workerId) ?? [];
    if (past.length === 0) {
      out.push({ id: `FIRST_PAYMENT:${o.id}`, code: "FIRST_PAYMENT", obligationId: o.id });
      continue;
    }
    if (past[0].recipient.toLowerCase() !== o.recipient.toLowerCase()) out.push({ id: `RECIPIENT_CHANGED:${o.id}`, code: "RECIPIENT_CHANGED", obligationId: o.id });
    const recent = past.slice(0, WINDOW);
    const total = recent.reduce((a, p) => a + p.amount, 0n);
    const n = BigInt(recent.length);
    // amount >= 2 x mean or <= 0.5 x mean, in integers (mean = total / n)
    if (o.amount * n >= 2n * total || o.amount * n * 2n <= total) out.push({ id: `AMOUNT_RATIO:${o.id}`, code: "AMOUNT_RATIO", obligationId: o.id });
  }
  if (i.previousConfigVersion !== null && i.previousConfigVersion !== i.configVersion) out.push({ id: "CONFIG_VERSION_CHANGED", code: "CONFIG_VERSION_CHANGED", obligationId: null });
  return out;
}
