import { TimeZonePreferenceSchema } from "@/core/timezone";
import { guarded } from "@/server/auth/guard";
import { loadProfileTimezone, saveProfileTimezone } from "@/server/db/profile-timezone";

export const GET = guarded({}, async ({ actor }) => Response.json(await loadProfileTimezone(actor), { headers: { "Cache-Control": "no-store" } }));
export const PATCH = guarded({ body: TimeZonePreferenceSchema }, async ({ actor, body }) => Response.json(await saveProfileTimezone(actor, body), { headers: { "Cache-Control": "no-store" } }));
