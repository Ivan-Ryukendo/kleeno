import "server-only";
import { PlatformAccountsSchema, type PlatformAccounts } from "@/core/growth/accounts";
import type { AdminActor } from "@/server/auth/admin";
import { AuthError } from "@/server/auth/session";
import { db, must } from "./client";

/** S52: caller passed the password/MFA admin guard; the DB rechecks current platform membership. */
export async function loadPlatformAccounts(actor: AdminActor): Promise<PlatformAccounts> {
  const data = must(await db().rpc("platform_account_inventory", { p_actor: actor.userId }), "platform inventory") as unknown;
  if (data && typeof data === "object" && "code" in data && data.code === "FORBIDDEN") throw new AuthError(403, "FORBIDDEN", "platform administrator access required");
  return PlatformAccountsSchema.parse(data);
}
