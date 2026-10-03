import { z } from "zod";
import { guarded } from "@/server/auth/guard";
import { decideLive } from "@/server/db/live-payments";

// The platform admin decides a company's live-payments request (S66; admin session + MFA, behind the secret admin path).
// Approving provisions the wallets and the guard; approving again resumes a provisioning that failed part-way.
const Body = z.object({ action: z.enum(["approve", "reject"]) }).strict();

export const POST = guarded<z.infer<typeof Body>, { companyId: string }>({ scope: "admin", body: Body }, async ({ admin, body, params, correlationId }) =>
  decideLive(admin, z.uuid().parse(params.companyId), body.action, correlationId),
);
