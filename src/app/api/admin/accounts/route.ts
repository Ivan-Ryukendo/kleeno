import { guarded } from "@/server/auth/guard";
import { loadPlatformAccounts } from "@/server/db/platform-accounts";

// Secret-path gate, platform membership, password-origin session and MFA are checked by admin scope.
export const GET = guarded({ scope: "admin" }, async ({ admin }) => loadPlatformAccounts(admin));
