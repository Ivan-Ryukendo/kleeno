import { guarded } from "@/server/auth/guard";
import { advanceTopup, TOPUP_ROLES } from "@/server/circle/gateway";
import { uuid } from "@/server/schemas";

// Continues a top-up that was already started with a password check (a deposit still confirming, a closed tab). It only resumes the saved
// steps of THIS company's request, so it grants nothing new and needs no password. Call again while `done` is false.
export const POST = guarded<undefined, { id: string }>({ roles: TOPUP_ROLES }, async ({ actor, params, correlationId }) =>
  advanceTopup({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, uuid.parse(params.id)),
);
