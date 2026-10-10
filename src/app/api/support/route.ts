import { guarded } from "@/server/auth/guard";
import { CreateSupportSchema } from "@/core/support";
import { createSupport, listSupport } from "@/server/db/support";
export const GET = guarded({}, async ({ actor }) => listSupport(actor));
export const POST = guarded({ body: CreateSupportSchema }, async ({ actor, body, correlationId }) => createSupport({ ...actor, correlationId }, body));
