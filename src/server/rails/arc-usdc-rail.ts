import "server-only";
import { assertGatePass, type GatePass } from "@/core/payments/gate";
import type { PaymentRail, RailStatus } from "@/core/ports";
import { circle, FEE } from "@/server/circle/client";

const FAILED = new Set(["FAILED", "DENIED", "CANCELLED"]);

/** The only PaymentRail. Encodes only `pay(bytes32)` from the agent wallet (S04). */
export function arcUsdcRail(cfg: { agentWalletId: string; guardAddress: string }): PaymentRail {
  return {
    async submit(pass: GatePass, attemptId: string) {
      assertGatePass(pass);
      const res = await circle().wallets.createContractExecutionTransaction({
        walletId: cfg.agentWalletId,
        contractAddress: cfg.guardAddress,
        abiFunctionSignature: "pay(bytes32)",
        abiParameters: [pass.onchainKey],
        fee: FEE,
        refId: attemptId, // links our attempt row to the Circle transaction
        idempotencyKey: pass.idempotencyKey,
      });
      const id = res.data?.id;
      if (!id) throw new Error("circle returned no transaction id");
      return { circleTxId: id };
    },

    async getStatus(circleTxId): Promise<RailStatus> {
      const tx = (await circle().wallets.getTransaction({ id: circleTxId })).data?.transaction;
      if (!tx) return { state: "PENDING" };
      if (FAILED.has(tx.state)) return { state: "FAILED" };
      // COMPLETE only means Circle is done: the agent still matches the Arc receipt before settling (rule 27).
      if (tx.state === "COMPLETE" && tx.txHash) return { state: "CONFIRMED", txHash: tx.txHash };
      return { state: "PENDING" }; // includes STUCK: stays PAYING until recovery (P4)
    },
  };
}
