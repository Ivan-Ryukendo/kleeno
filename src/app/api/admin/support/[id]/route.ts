import { guarded } from "@/server/auth/guard";
import { SupportAdminCommandSchema } from "@/core/support";
import { adminSupportAction, loadAdminSupport } from "@/server/db/support";
export const GET = guarded<undefined, { id: string }>({ scope: "admin" }, async ({ admin, params }) => loadAdminSupport(admin, params.id));
export const POST = guarded({ scope: "admin", body: SupportAdminCommandSchema }, async ({ admin, params, body, correlationId }) => adminSupportAction({ ...admin, correlationId }, params.id, body));
