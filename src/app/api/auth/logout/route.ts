import { clearCompanyCookie } from "@/server/auth/company";
import { guarded } from "@/server/auth/guard";

export const POST = guarded({ allowAal1: true }, async ({ client, cookies }) => {
  await client.auth.signOut(); // the guard's cookie sink turns this into cleared session cookies
  cookies.push(clearCompanyCookie());
  return { ok: true };
});
