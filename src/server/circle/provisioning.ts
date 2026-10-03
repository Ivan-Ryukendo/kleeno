import "server-only";
import { USDC_ADDRESS } from "@/server/arc/reader";
import { guardAbi } from "@/server/arc/guard-abi";
import { guardBytecode } from "@/server/arc/guard-bytecode";
import { db, must } from "@/server/db/client";
import { circle, deterministicUuid, FEE, waitForCircleTx, withFreshKeyOnFailure } from "./client";

// Live-payments provisioning (ARCHITECTURE 14.9, S66): the company's approver (treasury, guard owner) and agent (guard operator)
// wallets, then the PayrollGuard. Every step is idempotent: the database holds one wallet per company and role and one guard per
// company, and Circle idempotency keys are derived from the company, so a retry resumes where the last run stopped.
// The entity secret is registered by the user, never here (rule 31).
export interface Wallet {
  id: string;
  address: string;
}

export interface ProvisionPort {
  createWallets(companyId: string): Promise<{ approver: Wallet; agent: Wallet }>;
  /** Deploys PayrollGuard from the approver wallet (no raw deployer key anywhere) and returns its address. */
  deployGuard(o: { companyId: string; approver: Wallet; agentAddress: string }): Promise<string>;
}

export const circlePort: ProvisionPort = {
  async createWallets(companyId) {
    const set = await circle().wallets.createWalletSet({ name: `kleeno-${companyId.slice(0, 8)}`, idempotencyKey: deterministicUuid(`walletset:${companyId}`) });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("no wallet set id");
    const res = await circle().wallets.createWallets({ blockchains: ["ARC-TESTNET"], count: 2, walletSetId, accountType: "EOA", idempotencyKey: deterministicUuid(`wallets:${companyId}`) });
    const list = res.data?.wallets ?? [];
    if (list.length !== 2) throw new Error("expected 2 wallets");
    return { approver: { id: list[0].id, address: list[0].address }, agent: { id: list[1].id, address: list[1].address } };
  },

  async deployGuard({ companyId, approver, agentAddress }) {
    // A deployment Circle reported as failed gets a fresh key on the retry, otherwise Circle would replay the failure forever.
    return withFreshKeyOnFailure(`deploy-guard:${companyId}`, async (idempotencyKey) => {
      const dep = await circle().contracts.deployContract({
        name: "PayrollGuard",
        description: "Kleeno PayrollGuard",
        walletId: approver.id,
        blockchain: "ARC-TESTNET",
        abiJson: JSON.stringify(guardAbi),
        bytecode: guardBytecode,
        constructorParameters: [USDC_ADDRESS, approver.address, agentAddress],
        fee: FEE,
        idempotencyKey,
      });
      const { contractId, transactionId } = dep.data ?? {};
      if (!contractId || !transactionId) throw new Error("deployment not accepted");
      await waitForCircleTx(transactionId, 300_000);
      const address = (await circle().contracts.getContract({ id: contractId })).data?.contract?.contractAddress;
      if (!address) throw new Error("no contract address yet; run it again");
      return address;
    }, 4);
  },
};

const walletRows = async (companyId: string) => must(await db().from("company_wallets").select("role, circle_wallet_id, address").eq("company_id", companyId), "wallets read");

export async function provisionWallets(companyId: string, port: ProvisionPort = circlePort) {
  if ((await walletRows(companyId)).length < 2) {
    const w = await port.createWallets(companyId);
    const rows = [
      { role: "APPROVER", w: w.approver },
      { role: "AGENT", w: w.agent },
    ].map(({ role, w }) => ({ company_id: companyId, role, circle_wallet_id: w.id, address: w.address, blockchain: "ARC-TESTNET" }));
    must(await db().from("company_wallets").upsert(rows, { onConflict: "company_id,role", ignoreDuplicates: true }).select("id"), "wallet save");
  }
  const rows = await walletRows(companyId);
  const approver = rows.find((r) => r.role === "APPROVER");
  const agent = rows.find((r) => r.role === "AGENT");
  if (!approver || !agent) throw new Error("wallets incomplete");
  return { approver: { id: approver.circle_wallet_id as string, address: approver.address as string }, agent: { id: agent.circle_wallet_id as string, address: agent.address as string } };
}

export async function provisionGuard(companyId: string, port: ProvisionPort = circlePort) {
  const co = must(await db().from("companies").select("guard_address").eq("id", companyId).single(), "company read");
  if (co.guard_address) return co.guard_address as string;
  const { approver, agent } = await provisionWallets(companyId, port);
  const address = await port.deployGuard({ companyId, approver, agentAddress: agent.address });
  must(await db().from("companies").update({ guard_address: address }).eq("id", companyId).is("guard_address", null).select("id"), "guard save");
  return (must(await db().from("companies").select("guard_address").eq("id", companyId).single(), "company read").guard_address as string);
}

/** Wallets, then the guard. Returns the addresses; running it again changes nothing. */
export async function provisionCompany(companyId: string, port: ProvisionPort = circlePort) {
  const wallets = await provisionWallets(companyId, port);
  return { approver: wallets.approver.address, agent: wallets.agent.address, guard: await provisionGuard(companyId, port) };
}
