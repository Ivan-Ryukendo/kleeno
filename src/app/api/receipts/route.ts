import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { mintReceipt, RECEIPT_ROLES } from "@/server/db/receipts";
import { uuid } from "@/server/schemas";

// A signed, 30-day link to the public receipt of one SETTLED payment of the caller's company (S36). Returns the path to share.
// UI hook (not built here): POST { obligationId } from a "Copy receipt link" button on a SETTLED row in /settlement, then show `path` under SITE_URL.
const Body = z.object({ obligationId: uuid }).strict();

export const POST = guarded<z.infer<typeof Body>>({ roles: RECEIPT_ROLES, body: Body }, async ({ actor, body, correlationId }) =>
  mintReceipt({ companyId: actor.companyId, userId: actor.userId, roles: actor.roles, correlationId }, body.obligationId),
);
