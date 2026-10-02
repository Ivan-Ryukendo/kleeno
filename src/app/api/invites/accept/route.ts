import { z } from "zod";
import { openRoute } from "@/server/auth/guard";
import { isOwner } from "@/core/tenancy";
import { acceptInviteWithPassword } from "@/server/auth/invite";
import { AuthError } from "@/server/auth/session";
import { getCompany } from "@/server/db/company";
import { allow, clientKey } from "@/server/db/growth";

// Public, but only with a valid one-time token (S62). The email comes from the invite, never from the request.
const Body = z.object({ token: z.string().length(43), password: z.string().min(1).max(200) }).strict();

export const POST = openRoute({ body: Body }, async ({ body, request, jar, cookies, correlationId }) => {
  if (!(await allow("invite-accept", clientKey(request), 600, 10))) throw new AuthError(429, "THROTTLED", "Too many attempts. Please try again in a few minutes.");
  const { companyId, newAccount, roles } = await acceptInviteWithPassword({ token: body.token, password: body.password, jar, cookies, correlationId });
  // A new company's Owner starts with the setup wizard (which also sets up the second sign-in step).
  const next = isOwner(roles) && !(await getCompany(companyId)).onboardedAt ? "/onboarding" : "/dashboard";
  return { ok: true, newAccount, next };
});
