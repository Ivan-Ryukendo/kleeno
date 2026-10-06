import { z } from "zod";
import { auditEvent } from "@/core/audit";
import { toCsv, ViewSchema } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { writeAudit } from "@/server/db/audit";
import { queryTable } from "@/server/db/table-views";
import { uuid } from "@/server/schemas";

const Body = z.object({ view: ViewSchema, runId: uuid.nullable() }).strict();

// CSV of the current view: signed in, only the columns this role may see, cells escaped against spreadsheet formulas (S60),
// never cached, one audit event with the view and the row count and no values.
export const POST = guarded({ body: Body }, async ({ actor, client, body, correlationId }) => {
  const result = await queryTable(client, actor.companyId, actor.roles, body.view, body.runId, { all: true });
  await writeAudit(auditEvent({ companyId: actor.companyId, event: "view.export", entityType: "table_view", entityId: body.runId, actor: actor.userId, actorType: "user", correlationId, refs: { table: body.view.table, rows: result.total } }));
  return new Response(toCsv(result.rows, body.view, actor.roles, result.availableColumns?.filter((c) => c.resource)), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kleeno-${body.view.table}.csv"`, "cache-control": "no-store" },
  });
});
