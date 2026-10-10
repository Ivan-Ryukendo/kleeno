import { guarded } from "@/server/auth/guard";
import { listAdminSupport } from "@/server/db/support";
export const GET = guarded({ scope: "admin" }, async ({ admin }) => listAdminSupport(admin));
