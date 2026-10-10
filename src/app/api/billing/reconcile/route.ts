import { guarded } from "@/server/auth/guard";
import { reconcileStripeBilling } from "@/server/db/billing-provider";
export const POST = guarded({ roles: ["OWNER"] }, async ({ actor, correlationId }) => reconcileStripeBilling({ ...actor, correlationId }));
