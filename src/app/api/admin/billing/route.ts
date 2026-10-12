import { z } from "zod";
import { BillingCommandSchema } from "@/core/billing";
import { guarded } from "@/server/auth/guard";
import { billingAdminCommand, listBillingTiers, loadAdminBilling } from "@/server/db/billing";
export const GET = guarded({ scope: "admin" }, async ({ admin, request }) => {
  const companyId = new URL(request.url).searchParams.get("companyId");
  return companyId ? loadAdminBilling(admin, z.string().uuid().parse(companyId)) : listBillingTiers(admin);
});
export const POST = guarded({ scope: "admin", body: BillingCommandSchema }, async ({ admin, body, correlationId }) => billingAdminCommand({ ...admin, correlationId }, body));
