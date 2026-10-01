import { TransitionError } from "@/core/domain/machines";
import { auditEvent } from "@/core/audit";
import { guarded } from "@/server/auth/guard";
import { createWorkerWallet } from "@/server/circle/worker-wallet";
import { writeAudit } from "@/server/db/audit";
import { db } from "@/server/db/client";
import { setWorkerWallet } from "@/server/db/workers";
import { uuid } from "@/server/schemas";

// Provisions the worker's company-managed wallet. Safe to repeat: an existing wallet is returned unchanged.
export const POST = guarded<undefined, { id: string }>({ roles: ["PAYROLL_APPROVER", "HR_APPROVER"] }, async ({ actor, params, correlationId }) => {
  const id = uuid.safeParse(params.id);
  const worker = id.success ? (await db().from("workers").select("id, wallet_id, wallet_address").eq("id", id.data).eq("company_id", actor.companyId).maybeSingle()).data : null;
  if (!worker) throw new TransitionError("NOT_FOUND", "worker not found");
  if (worker.wallet_id) return { address: worker.wallet_address };
  const w = await createWorkerWallet(actor.companyId, worker.id);
  await setWorkerWallet(actor.companyId, worker.id, { walletId: w.walletId, address: w.address, source: "CIRCLE" });
  await writeAudit(auditEvent({ companyId: actor.companyId, event: "worker.wallet", entityType: "worker", entityId: worker.id, actor: actor.userId, actorType: "user", correlationId, refs: { source: "CIRCLE" } }));
  return { address: w.address };
});
