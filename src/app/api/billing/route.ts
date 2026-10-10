import { guarded } from "@/server/auth/guard";
import { loadOwnerBilling } from "@/server/db/billing";
export const GET = guarded({ roles: ["OWNER"] }, async ({ actor }) => loadOwnerBilling(actor));
