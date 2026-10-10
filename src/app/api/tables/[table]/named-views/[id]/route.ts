import { z } from "zod";
import { NamedViewCommandSchema } from "@/core/named-views";
import { TABLE_IDS } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { loadNamedView, namedViewAction } from "@/server/db/named-views";
const Params = z.object({ table: z.enum(TABLE_IDS), id: z.string().uuid() }).strict();
export const GET = guarded({}, async ({ actor, client, params, correlationId }) => { const p = Params.parse(params); return loadNamedView(client, { ...actor, correlationId }, p.table, p.id); });
export const POST = guarded({ body: NamedViewCommandSchema }, async ({ actor, client, body, params, correlationId }) => { const p = Params.parse(params); return namedViewAction(client, { ...actor, correlationId }, p.table, p.id, body); });
