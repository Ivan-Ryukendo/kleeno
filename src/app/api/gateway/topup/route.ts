import { z } from "zod";
import { parseUsdc } from "@/core/money";
import { guarded } from "@/server/auth/guard";
import { requireReauth } from "@/server/auth/login";
import { advanceTopup, requestTopup, TOPUP_ROLES, topupInfo } from "@/server/circle/gateway";
import { usdc, uuid } from "@/server/schemas";

// Gateway top-up of the company's OWN payroll wallet (S67). The destination is never in the request: it comes from the database.
// Starting one adds funds to a wallet the company already owns, but it moves value, so the password is re-checked in this request.
const Body = z.object({ requestId: uuid, amount: usdc, password: z.string().min(1).max(200) }).strict();

export const GET = guarded({ roles: TOPUP_ROLES }, async ({ actor }) => topupInfo(actor.companyId));

export const POST = guarded<z.infer<typeof Body>>({ roles: TOPUP_ROLES, body: Body }, async ({ actor, body, correlationId }) => {
  await requireReauth(actor, body.password, correlationId);
  const who = { companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId };
  const started = await requestTopup(who, { requestId: body.requestId, amount: parseUsdc(body.amount) });
  return advanceTopup(who, started.id);
});
