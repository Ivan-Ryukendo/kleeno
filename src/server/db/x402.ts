import "server-only";
import { db } from "./client";

// Kleeno Verify ledger (S68, rule 49): one row per signed payment, keyed by the buyer's authorization nonce (unique in the database).
// A row is written BEFORE settlement, so the same signed payment can never buy two answers even if two requests race.
export interface Ledger {
  /** "REPLAY" when this authorization was already seen. */
  begin(p: { companyId: string; obligationId: string; nonce: string; payer: string; amount: bigint }): Promise<"NEW" | "REPLAY">;
  finish(nonce: string, outcome: { status: "SETTLED" | "FAILED"; ref?: string; payer?: string }): Promise<void>;
}

export const x402Ledger: Ledger = {
  async begin(p) {
    const { error } = await db().from("x402_payments").insert({ company_id: p.companyId, obligation_id: p.obligationId, nonce: p.nonce, payer: p.payer, amount: Number(p.amount), network: "eip155:5042002" });
    if (error?.code === "23505") return "REPLAY";
    if (error) throw new Error(`db x402 begin failed (${error.code})`);
    return "NEW";
  },
  async finish(nonce, o) {
    const patch: Record<string, string> = { status: o.status };
    if (o.ref) patch.settlement_ref = o.ref;
    if (o.payer && /^0x[0-9a-fA-F]{40}$/.test(o.payer)) patch.payer = o.payer.toLowerCase();
    const { error } = await db().from("x402_payments").update(patch).eq("nonce", nonce).eq("status", "PENDING");
    if (error) throw new Error(`db x402 finish failed (${error.code})`);
  },
};
