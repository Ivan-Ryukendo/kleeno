import { z } from "zod";
import { TABLE_IDS } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { addCellComment, cellComments } from "@/server/db/table-workspace";
import { uuid } from "@/server/schemas";

const Target = z.object({ table: z.enum(TABLE_IDS), runId: uuid.nullable(), rowId: uuid, columnId: z.string().min(1).max(30) }).strict();
export const GET = guarded({}, async ({ actor, client, request }) => {
  const p = new URL(request.url).searchParams;
  const target = Target.parse({ table: p.get("table"), runId: p.get("runId") || null, rowId: p.get("rowId"), columnId: p.get("columnId") });
  return cellComments(client, actor.companyId, actor.roles, target);
});
const Body = Target.extend({ text: z.string().trim().min(1).max(2000) }).strict();
export const POST = guarded({ body: Body }, async ({ actor, client, body, correlationId }) => addCellComment({ ...actor, correlationId }, client, body, body.text));
