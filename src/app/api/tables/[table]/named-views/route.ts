import { z } from "zod";
import { CreateNamedViewSchema } from "@/core/named-views";
import { TABLE_IDS } from "@/core/views";
import { guarded } from "@/server/auth/guard";
import { createNamedView, listNamedViews } from "@/server/db/named-views";
const Params = z.object({ table: z.enum(TABLE_IDS) }).strict();
export const GET = guarded({}, async ({ actor, client, params, correlationId }) => listNamedViews(client, { ...actor, correlationId }, Params.parse(params).table));
export const POST = guarded({ body: CreateNamedViewSchema }, async ({ actor, client, body, params, correlationId }) => createNamedView(client, { ...actor, correlationId }, Params.parse(params).table, body));
