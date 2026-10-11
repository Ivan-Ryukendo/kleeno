import "server-only";
import { resolveTimeZone } from "@/core/timezone";
import { getCompany } from "@/server/db/company";
import { loadProfileTimezone } from "@/server/db/profile-timezone";

/** Display zone for the signed-in viewer (RT.2): own preference, else company, else UTC.
 * Display only: stored timestamps stay UTC. A missing/unavailable preference store never blocks the page. */
export async function viewerTimeZone(who: { userId: string; companyId: string }, companyTimezone?: string | null): Promise<string> {
  try {
    return (await loadProfileTimezone(who)).timeZone;
  } catch {
    try {
      return resolveTimeZone(null, companyTimezone !== undefined ? companyTimezone : (await getCompany(who.companyId)).profile.timezone).timeZone;
    } catch {
      return "UTC";
    }
  }
}
