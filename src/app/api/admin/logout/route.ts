import { guarded } from "@/server/auth/guard";

export const POST = guarded({ scope: "admin", allowAal1: true }, async ({ client }) => {
  await client.auth.signOut({ scope: "local" }); // the guard's cookie sink turns this into cleared session cookies
  return { ok: true };
});
