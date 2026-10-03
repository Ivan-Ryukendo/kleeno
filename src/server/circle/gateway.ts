import "server-only";
import { randomBytes } from "node:crypto";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { burnIntentTypedData, checkTopupAmount, depositFor, GATEWAY_MINTER, GATEWAY_WALLET, ARC, maxFeeFor, SOURCES, TOPUP_CAP, type SourceChain } from "@/core/gateway";
import { formatUsdc } from "@/core/money";
import { hasRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { writeAudit } from "@/server/db/audit";
import { db, must } from "@/server/db/client";
import { circle, deterministicUuid, FEE } from "./client";

// Gateway top-up (S67, rule 28, ARCHITECTURE 14.10). Moves the company's OWN USDC from a source testnet chain into its OWN approver
// wallet on Arc, through Circle's Gateway: derive the approver's address on the source chain -> approve + deposit into the Gateway
// Wallet -> wait until Gateway credits it -> sign a burn intent with Circle wallet typed-data signing (no raw key) -> Gateway attests ->
// mint on Arc. Every step is saved before the next (a retry resumes), every Circle call carries an idempotency key derived from the
// transfer, and the recipient is read from the database and frozen there by a trigger. Nothing here pays a worker, opens a guard run or
// creates an obligation (structure test): batches still fund PayrollGuard only through `openRun`.
const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1"; // Arc testnet only (rule 29)

export interface GatewayPort {
  /** The approver's address on the source chain: Circle creates the same address there (EOA wallets). */
  deriveSourceWallet(approverWalletId: string, chain: SourceChain): Promise<{ walletId: string }>;
  execute(o: { walletId: string; contract: string; signature: string; params: unknown[]; idempotencyKey: string; refId: string }): Promise<{ txId: string }>;
  txState(txId: string): Promise<{ state: "PENDING" | "COMPLETE" | "FAILED"; txHash?: string }>;
  signTypedData(o: { walletId: string; data: string }): Promise<string>;
  /** USDC credited in the Gateway Wallet for this depositor on this domain (6 dp). */
  gatewayBalance(domain: number, depositor: string): Promise<bigint>;
  transfer(burnIntent: unknown, signature: string): Promise<{ attestation: string; signature: string }>;
}

const TERMINAL_FAIL = new Set(["FAILED", "DENIED", "CANCELLED"]);

export const circleGatewayPort: GatewayPort = {
  async deriveSourceWallet(approverWalletId, chain) {
    const res = await circle().wallets.deriveWallet({ id: approverWalletId, blockchain: SOURCES[chain].walletChain });
    const id = res.data?.wallet?.id;
    if (!id) throw new Error("no source wallet");
    return { walletId: id };
  },
  async execute(o) {
    const res = await circle().wallets.createContractExecutionTransaction({
      walletId: o.walletId,
      contractAddress: o.contract,
      abiFunctionSignature: o.signature,
      abiParameters: o.params,
      fee: FEE,
      refId: o.refId,
      idempotencyKey: o.idempotencyKey,
    });
    const txId = res.data?.id;
    if (!txId) throw new Error("circle returned no transaction id");
    return { txId };
  },
  async txState(txId) {
    const tx = (await circle().wallets.getTransaction({ id: txId })).data?.transaction;
    if (!tx) return { state: "PENDING" };
    if (TERMINAL_FAIL.has(tx.state)) return { state: "FAILED" };
    return tx.state === "COMPLETE" && tx.txHash ? { state: "COMPLETE", txHash: tx.txHash } : { state: "PENDING" };
  },
  async signTypedData(o) {
    const res = await circle().wallets.signTypedData({ walletId: o.walletId, data: o.data });
    const sig = res.data?.signature;
    if (!sig) throw new Error("no signature");
    return sig;
  },
  async gatewayBalance(domain, depositor) {
    const res = await fetch(`${GATEWAY_API}/balances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "USDC", sources: [{ domain, depositor }] }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`gateway balances ${res.status}`);
    const row = ((await res.json()) as { balances?: { domain: number; balance: string }[] }).balances?.find((b) => b.domain === domain);
    const [whole, frac = ""] = (row?.balance ?? "0").split(".");
    return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  },
  async transfer(burnIntent, signature) {
    const res = await fetch(`${GATEWAY_API}/transfer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ burnIntent, signature }]), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`gateway transfer ${res.status}`);
    const out = (await res.json()) as { attestation?: string; signature?: string };
    if (!out.attestation || !out.signature) throw new Error("gateway returned no attestation");
    return { attestation: out.attestation, signature: out.signature };
  },
};

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}
type Row = {
  id: string; company_id: string; request_id: string; amount: number | string; max_fee: number | string; source_chain: SourceChain; depositor: string; recipient: string; status: string;
  source_wallet_id: string | null; approve_tx_id: string | null; deposit_tx_id: string | null; burn_salt: string | null; burn_signature: string | null;
  attestation: string | null; operator_signature: string | null; mint_tx_id: string | null; mint_tx_hash: string | null; failure: string | null;
};
export const TOPUP_ROLES: readonly Role[] = ["OWNER", "PAYMENT_APPROVER"];

const load = async (companyId: string, id: string) => {
  const row = (await db().from("gateway_transfers").select("*").eq("company_id", companyId).eq("id", id).maybeSingle()).data as Row | null;
  if (!row) throw new TransitionError("NOT_FOUND", "no such top-up");
  return row;
};
const note = (who: Who, event: string, id: string, refs: Record<string, string | number | boolean | null> = {}) =>
  writeAudit(auditEvent({ companyId: who.companyId, event, entityType: "gateway_transfer", entityId: id, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId(), refs }));
const patch = async (row: Row, from: string, values: Record<string, unknown>) => {
  const rows = must(await db().from("gateway_transfers").update(values).eq("id", row.id).eq("company_id", row.company_id).eq("status", from).select("id"), "gateway step save");
  return rows.length === 1; // false: another request moved it first; the caller re-reads
};
const approverWallet = async (companyId: string) => (await db().from("company_wallets").select("circle_wallet_id, address").eq("company_id", companyId).eq("role", "APPROVER").maybeSingle()).data;

/** The safe view of a top-up: addresses, amounts and status. No signatures, attestations or Circle IDs. */
const view = (r: Row) => ({ id: r.id, status: r.status, amount: formatUsdc(BigInt(r.amount)), sourceChain: r.source_chain, recipient: r.recipient, mintTxHash: r.mint_tx_hash, failure: r.failure });

/**
 * Starts a top-up (the route has already re-checked the password). The destination is the company's approver wallet from the database;
 * the request carries only an amount and its own idempotency key. A repeat of the same request returns the same transfer.
 */
export async function requestTopup(who: Who, input: { requestId: string; amount: bigint; source?: SourceChain }) {
  if (!hasRole(who.roles, ...TOPUP_ROLES)) throw new WorkflowError("FORBIDDEN", "only the Owner or a payment approver can top up the payroll wallet");
  const bad = checkTopupAmount(input.amount);
  if (bad) throw new WorkflowError("CONFLICT", bad);
  const existing = (await db().from("gateway_transfers").select("*").eq("company_id", who.companyId).eq("request_id", input.requestId).maybeSingle()).data as Row | null;
  if (existing) {
    if (BigInt(existing.amount) !== input.amount) throw new WorkflowError("CONFLICT", "that request ID was used for a different amount");
    return view(existing);
  }
  const approver = await approverWallet(who.companyId);
  if (!approver) throw new WorkflowError("NOT_PROVISIONED", "this company has no payroll wallet yet");
  const { data, error } = await db()
    .from("gateway_transfers")
    .insert({ company_id: who.companyId, request_id: input.requestId, requested_by: who.userId, amount: Number(input.amount), max_fee: Number(maxFeeFor(input.amount)), source_chain: input.source ?? "BASE-SEPOLIA", depositor: approver.address, recipient: approver.address })
    .select("*")
    .single();
  if (error?.code === "23505") throw new WorkflowError("CONFLICT", "another top-up is still in progress for this company");
  if (error || !data) throw new Error(`db gateway request failed${error?.code ? ` (${error.code})` : ""}`);
  await note(who, "gateway.topup.requested", data.id, { source: data.source_chain });
  return view(data as Row);
}

const fail = async (who: Who, row: Row, from: string, code: string) => {
  await patch(row, from, { status: "FAILED", failure: code });
  await note(who, "gateway.topup.failed", row.id, { code });
};

/** Runs one Circle transaction step: submit once (idempotency key from the transfer), save its ID, then look at its state. */
async function txStep(port: GatewayPort, row: Row, col: "approve_tx_id" | "deposit_tx_id" | "mint_tx_id", send: () => Promise<{ txId: string }>, budgetMs: number) {
  let txId = row[col];
  if (!txId) {
    txId = (await send()).txId;
    must(await db().from("gateway_transfers").update({ [col]: txId }).eq("id", row.id).eq("company_id", row.company_id).is(col, null).select("id"), "gateway tx save");
  }
  const until = Date.now() + budgetMs;
  for (;;) {
    const s = await port.txState(txId);
    if (s.state !== "PENDING") return s;
    if (Date.now() >= until) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Moves a top-up as far as it can within `budgetMs` and says where it stopped. Safe to call again at any time (a crash, a closed tab, a
 * Gateway deposit that is still being credited): saved steps are reused, never repeated.
 */
export async function advanceTopup(who: Who, id: string, o: { port?: GatewayPort; budgetMs?: number } = {}) {
  if (!hasRole(who.roles, ...TOPUP_ROLES)) throw new WorkflowError("FORBIDDEN", "only the Owner or a payment approver can top up the payroll wallet");
  const port = o.port ?? circleGatewayPort;
  const budget = o.budgetMs ?? 20_000;
  const deadline = Date.now() + budget;
  const left = () => Math.max(0, deadline - Date.now());
  const key = (r: Row, step: string) => deterministicUuid(`gateway:${r.id}:${step}`);

  for (let guard = 0; guard < 20; guard++) {
    const row = await load(who.companyId, id);
    const amount = BigInt(row.amount);
    const src = SOURCES[row.source_chain];
    const approver = await approverWallet(who.companyId);
    if (row.status === "COMPLETE" || row.status === "FAILED") return { ...view(row), done: true };
    if (!approver || approver.address.toLowerCase() !== row.recipient.toLowerCase()) {
      await fail(who, row, row.status, "RECIPIENT_MISMATCH"); // the wallet on file is no longer the one this top-up was made for
      continue;
    }

    if (row.status === "REQUESTED") {
      const w = await port.deriveSourceWallet(approver.circle_wallet_id, row.source_chain);
      await patch(row, "REQUESTED", { source_wallet_id: row.source_wallet_id ?? w.walletId, status: "SOURCE_READY" });
      await note(who, "gateway.topup.step", row.id, { step: "SOURCE_READY" });
    } else if (row.status === "SOURCE_READY" || row.status === "APPROVED") {
      const approve = row.status === "SOURCE_READY";
      const s = await txStep(
        port,
        row,
        approve ? "approve_tx_id" : "deposit_tx_id",
        () =>
          port.execute({
            walletId: row.source_wallet_id as string,
            contract: approve ? src.usdc : GATEWAY_WALLET,
            signature: approve ? "approve(address,uint256)" : "deposit(address,uint256)",
            params: approve ? [GATEWAY_WALLET, depositFor(amount).toString()] : [src.usdc, depositFor(amount).toString()],
            idempotencyKey: key(row, approve ? "approve" : "deposit"),
            refId: `${row.id}:${approve ? "approve" : "deposit"}`,
          }),
        left(),
      );
      if (s.state === "FAILED") await fail(who, row, row.status, approve ? "APPROVE_FAILED" : "DEPOSIT_FAILED");
      else if (s.state === "PENDING") return { ...view(row), done: false, waiting: approve ? "approval confirming" : "deposit confirming" };
      else {
        await patch(row, row.status, { status: approve ? "APPROVED" : "DEPOSITED" });
        await note(who, "gateway.topup.step", row.id, { step: approve ? "APPROVED" : "DEPOSITED" });
      }
    } else if (row.status === "DEPOSITED") {
      if ((await port.gatewayBalance(src.domain, row.depositor)) < depositFor(amount)) return { ...view(row), done: false, waiting: "Gateway is crediting the deposit" };
      await patch(row, "DEPOSITED", { status: "CREDITED" });
      await note(who, "gateway.topup.step", row.id, { step: "CREDITED" });
    } else if (row.status === "CREDITED") {
      // The salt and signature are saved before the Gateway call, so a retry sends the identical signed intent.
      let salt = row.burn_salt;
      if (!salt) {
        salt = `0x${randomBytes(32).toString("hex")}`;
        must(await db().from("gateway_transfers").update({ burn_salt: salt }).eq("id", row.id).eq("company_id", row.company_id).is("burn_salt", null).select("id"), "gateway salt save");
        continue; // re-read: a concurrent request may have saved its own salt first, and that one wins
      }
      const typed = burnIntentTypedData({ source: row.source_chain, depositor: row.depositor, recipient: row.recipient, amount, maxFee: BigInt(row.max_fee), salt });
      let signature = row.burn_signature;
      if (!signature) {
        signature = await port.signTypedData({ walletId: row.source_wallet_id as string, data: JSON.stringify(typed) });
        must(await db().from("gateway_transfers").update({ burn_signature: signature }).eq("id", row.id).eq("company_id", row.company_id).is("burn_signature", null).select("id"), "gateway signature save");
        continue;
      }
      let att;
      try {
        att = await port.transfer(typed.message, signature);
      } catch {
        return { ...view(row), done: false, waiting: "Gateway has not accepted the transfer yet; try again shortly" };
      }
      await patch(row, "CREDITED", { attestation: att.attestation, operator_signature: att.signature, status: "ATTESTED" });
      await note(who, "gateway.topup.step", row.id, { step: "ATTESTED" });
    } else if (row.status === "ATTESTED") {
      const s = await txStep(
        port,
        row,
        "mint_tx_id",
        () => port.execute({ walletId: approver.circle_wallet_id, contract: GATEWAY_MINTER, signature: "gatewayMint(bytes,bytes)", params: [row.attestation, row.operator_signature], idempotencyKey: key(row, "mint"), refId: `${row.id}:mint` }),
        left(),
      );
      if (s.state === "FAILED") await fail(who, row, "ATTESTED", "MINT_FAILED"); // the attestation stays saved for recovery
      else if (s.state === "PENDING") return { ...view(row), done: false, waiting: "mint confirming on Arc" };
      else {
        await patch(row, "ATTESTED", { status: "COMPLETE", mint_tx_hash: s.txHash });
        await note(who, "gateway.topup.completed", row.id, { chain: ARC.walletChain });
      }
    }
  }
  return { ...view(await load(who.companyId, id)), done: false, waiting: "try again" };
}

/** What the top-up panel needs: where to send funds on the source chain, the limits, and the latest transfers. */
export async function topupInfo(companyId: string) {
  const approver = await approverWallet(companyId);
  const recent = ((await db().from("gateway_transfers").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(5)).data ?? []) as Row[];
  return { available: !!approver, sourceChain: "BASE-SEPOLIA" as const, sourceAddress: approver?.address ?? null, cap: formatUsdc(TOPUP_CAP), recent: recent.map(view) };
}
