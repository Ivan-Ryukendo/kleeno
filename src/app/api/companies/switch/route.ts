import { z } from "zod";
import { auditEvent } from "@/core/audit";
import { companyCookie } from "@/server/auth/company";
import { AuthError } from "@/server/auth/session";
import { guarded } from "@/server/auth/guard";
import { writeAudit } from "@/server/db/audit";

// Chooses the active company. `target` is only a choice: it must be one of the caller's own memberships (S61, S65).
const Body = z.object({ target: z.string().uuid() }).strict();

export const POST = guarded({ noCompany: true, body: Body }, async ({ user, body, cookies, correlationId }) => {
  if (!user.companies.some((c) => c.companyId === body.target)) throw new AuthError(403, "NO_COMPANY", "you are not a member of that company");
  cookies.push(companyCookie(body.target));
  await writeAudit(auditEvent({ companyId: body.target, event: "company.switch", entityType: "user", entityId: user.userId, actor: user.userId, actorType: "user", correlationId }));
  return { ok: true };
});
