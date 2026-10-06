import { z } from "zod";
import { openRoute } from "@/server/auth/guard";
import { oauthNextCookie, oauthRedirectTo } from "@/server/auth/oauth";
import { sessionClient } from "@/server/auth/session";

const Body = z.object({ next: z.string().max(100).optional() }).strict();

// Starts Google sign-in (PKCE). The server builds the authorize URL so the code verifier lands in an httpOnly cookie, never in
// browser JS. Sign-up stays off in Supabase, so only existing accounts get through; /auth/callback does the rest (S74).
export const POST = openRoute({ body: Body }, async ({ body, request, jar, cookies }) => {
  const { data, error } = await sessionClient(jar, cookies).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: oauthRedirectTo(new URL(request.url).origin), scopes: "openid email profile", skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error("oauth start failed");
  cookies.push(oauthNextCookie(body.next)); // 10 minutes, already allow-listed
  return { url: data.url };
});
