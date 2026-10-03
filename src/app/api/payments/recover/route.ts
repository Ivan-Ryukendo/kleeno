import { auditEvent } from "@/core/audit";
import { guarded } from "@/server/auth/guard";
import { writeAudit } from "@/server/db/audit";
import { assertRecoverRate, recoverPayments } from "@/server/payments/execute";

// Finishes payments a crash or timeout left PAYING (S29, S31). Scoped to the session's company, repeatable, rate-limited,
// and it can only settle from the Arc receipt or resubmit through the gate; it never pays around it.
export const POST = guarded({ roles: ["PAYMENT_APPROVER", "OWNER"] }, async ({ actor, correlationId }) => {
  await assertRecoverRate(actor.companyId);
  await writeAudit(auditEvent({ companyId: actor.companyId, event: "payments.recover", entityType: "company", entityId: actor.companyId, actor: actor.userId, actorType: "user", correlationId }));
  return recoverPayments(actor.companyId, { actor: { id: actor.userId, type: "user" }, correlationId });
});
