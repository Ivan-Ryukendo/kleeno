import { guarded } from "@/server/auth/guard";
import { SupportUserCommandSchema } from "@/core/support";
import { loadSupport, supportAction } from "@/server/db/support";
export const GET = guarded<undefined, { id: string }>({}, async ({ actor, params }) => loadSupport(actor, params.id));
export const POST = guarded({ body: SupportUserCommandSchema }, async ({ actor, params, body, correlationId }) => supportAction({ ...actor, correlationId }, params.id, body));
