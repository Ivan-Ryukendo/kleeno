import { z } from "zod";
import { companyCookie } from "@/server/auth/company";
import { guarded } from "@/server/auth/guard";
import { createAnotherCompany } from "@/server/db/company";

// An Owner starts another company (S64). It begins in SIMULATION with live payments off, and becomes the active company.
const Body = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const POST = guarded({ roles: ["OWNER"], body: Body }, async ({ actor, body, cookies, correlationId }) => {
  const company = await createAnotherCompany({ userId: actor.userId, email: actor.email }, body.name, correlationId);
  cookies.push(companyCookie(company.id));
  return { id: company.id };
});
