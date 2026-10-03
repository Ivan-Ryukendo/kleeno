import { z } from "zod";
import { hasRole } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { guarded } from "@/server/auth/guard";
import { requireReauth, requireTotp } from "@/server/auth/login";
import { requestLive, switchLive } from "@/server/db/live-payments";

// Live payments (S66). request: the Owner asks. switch_on: the Owner, with the password AND a fresh authenticator code in this request.
// switch_off: the Owner or a payment approver, nothing extra (it only reduces authority). The service re-checks who may do what.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }).strict(),
  z.object({ action: z.literal("switch_on"), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("switch_off") }).strict(),
]);

export const POST = guarded<z.infer<typeof Body>>({ roles: ["OWNER", "PAYMENT_APPROVER"], body: Body }, async ({ actor, client, body, correlationId }) => {
  const who = { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId };
  if (body.action === "request") return requestLive(who);
  if (body.action === "switch_off") return switchLive(who, false);
  if (!hasRole(actor.roles, "OWNER")) throw new WorkflowError("FORBIDDEN", "only the Owner can switch live payments on"); // before asking for any credential
  await requireReauth(actor, body.password, correlationId);
  await requireTotp(client, actor, body.code, correlationId);
  return switchLive(who, true);
});
