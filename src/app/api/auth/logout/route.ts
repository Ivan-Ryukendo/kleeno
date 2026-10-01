import { guarded } from "@/server/auth/guard";

export const POST = guarded({ allowAal1: true }, async ({ client }) => {
  await client.auth.signOut(); // the guard's cookie sink turns this into cleared session cookies
  return { ok: true };
});
