import { z } from "zod";
import { TABLE_IDS, ViewSchema } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { loadLayout, saveLayout } from "@/server/db/table-workspace";

export const GET = guarded({}, async ({ actor, client, request }) => {
  const table = z.enum(TABLE_IDS).parse(new URL(request.url).searchParams.get("table"));
  return loadLayout(client, actor.companyId, actor.userId, actor.roles, table);
});
const Body = z.object({ view: ViewSchema, expectedVersion: z.number().int().positive().nullable() }).strict();
export const POST = guarded({ body: Body }, async ({ actor, body, correlationId }) => saveLayout({ ...actor, correlationId }, body.view, body.expectedVersion));
