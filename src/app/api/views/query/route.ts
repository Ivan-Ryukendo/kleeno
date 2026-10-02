import { z } from "zod";
import { ViewSchema } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { queryTable } from "@/server/db/table-views";
import { uuid } from "@/server/schemas";

// A view is strict data (S59). Reads go through the user-scoped client under RLS, in the session's company and role.
const Body = z.object({ view: ViewSchema, runId: uuid.nullable() }).strict();

export const POST = guarded({ body: Body }, async ({ actor, client, body }) => queryTable(client, actor.companyId, actor.roles, body.view, body.runId));
