import "server-only";
import { auditEvent, newCorrelationId } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { hasRole, type Role } from "@/core/tenancy";
import { mintReceiptToken, readReceiptToken, type ReceiptFacts } from "@/core/receipt";
import { WorkflowError } from "@/core/workflow";
import { env } from "@/server/env";
import { writeAudit } from "./audit";
import { db, must } from "./client";

// Receipts (S36) and the read-only answer Kleeno Verify sells (S68). Both show the same allow-listed facts about ONE obligation.
// Never a name, worker ID, gross, deductions, trace or company: the selects below name every column they read.
export const receiptSecret = () => {
  if (!env.RECEIPT_HMAC_SECRET) throw new Error("RECEIPT_HMAC_SECRET is not set"); // fail closed: no secret, no receipts
  return env.RECEIPT_HMAC_SECRET;
};

interface Who {
  companyId: string;
  userId: string;
  roles: readonly Role[];
  correlationId?: string;
}

/** Roles that may hand a worker a receipt link: the people who run payroll and payments. */
export const RECEIPT_ROLES: readonly Role[] = ["OWNER", "PAYMENT_APPROVER", "PAYROLL_APPROVER", "HR_APPROVER"];

/** A signed link for one SETTLED obligation of the caller's company. Minting grants no payment authority, so it needs no re-auth. */
export async function mintReceipt(who: Who, obligationId: string, secret: string = receiptSecret()) {
  if (!hasRole(who.roles, ...RECEIPT_ROLES)) throw new WorkflowError("FORBIDDEN", "your role cannot create receipt links");
  const ob = (await db().from("obligations").select("id, status").eq("company_id", who.companyId).eq("id", obligationId).maybeSingle()).data;
  if (!ob) throw new TransitionError("NOT_FOUND", "no such payment"); // other companies' obligations look the same as missing ones
  if (ob.status !== "SETTLED") throw new WorkflowError("CONFLICT", "a receipt exists only for a settled payment");
  const minted = mintReceiptToken(secret, ob.id);
  await writeAudit(auditEvent({ companyId: who.companyId, event: "receipt.minted", entityType: "obligation", entityId: ob.id, actor: who.userId, actorType: "user", correlationId: who.correlationId ?? newCorrelationId(), refs: { expiresAt: minted.expiresAt.toISOString() } }));
  return { token: minted.token, path: `/receipt/${minted.token}`, expiresAt: minted.expiresAt.toISOString() };
}

const OBLIGATION_COLUMNS = "id, company_id, status, amount, tx_hash, calculation_hash, calculation_line_id, approval_id";

type Row = { id: string; company_id: string; status: string; amount: number | string; tx_hash: string | null; calculation_hash: string; calculation_line_id: string; approval_id: string };

async function factsOf(o: Row): Promise<ReceiptFacts> {
  const line = (await db().from("calculation_lines").select("net").eq("company_id", o.company_id).eq("id", o.calculation_line_id).maybeSingle()).data;
  const approval = (await db().from("payroll_approvals").select("calculation_hash").eq("company_id", o.company_id).eq("id", o.approval_id).maybeSingle()).data;
  const amount = BigInt(o.amount);
  return {
    status: o.status,
    amount,
    txHash: o.tx_hash,
    network: "ARC-TESTNET",
    matchesApproved: !!line && !!approval && BigInt(line.net) === amount && approval.calculation_hash === o.calculation_hash,
  };
}

/** The receipt page: null for a bad, forged or expired token and for an obligation that is gone (the page shows one calm message). */
export async function receiptByToken(token: string, secret: string = receiptSecret()): Promise<ReceiptFacts | null> {
  const id = readReceiptToken(secret, token);
  if (!id) return null;
  const o = (await db().from("obligations").select(OBLIGATION_COLUMNS).eq("id", id).maybeSingle()).data as Row | null;
  return o ? factsOf(o) : null;
}

/** Kleeno Verify target: either a receipt token or an obligation's hashed on-chain key. `companyId` lets the caller record the payment. */
export async function verifyTarget(target: { receipt: string } | { obligation: string }, secret?: string): Promise<{ obligationId: string; companyId: string } | null> {
  let q = db().from("obligations").select("id, company_id");
  if ("receipt" in target) {
    const id = readReceiptToken(secret ?? receiptSecret(), target.receipt);
    if (!id) return null;
    q = q.eq("id", id);
  } else q = q.eq("onchain_key", target.obligation.toLowerCase());
  const o = (await q.maybeSingle()).data;
  return o ? { obligationId: o.id, companyId: o.company_id } : null;
}

export async function factsForObligation(obligationId: string): Promise<ReceiptFacts> {
  return factsOf(must(await db().from("obligations").select(OBLIGATION_COLUMNS).eq("id", obligationId).single(), "obligation read") as Row);
}
