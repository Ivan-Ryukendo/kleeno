import { NextResponse } from "next/server";
import { openRoute } from "@/server/auth/guard";
import { handleCallback } from "@/server/auth/oauth-session";

// Google sign-in lands here (S74). The checks live in src/server/auth/oauth.ts; this only turns the result into a redirect.
// Public like /login, but 404 in waitlist mode (the proxy and `openRoute` both enforce it).
export const GET = openRoute({}, async ({ request, jar, cookies, correlationId }) => {
  const { to } = await handleCallback(request, jar, cookies, correlationId);
  return NextResponse.redirect(new URL(to, new URL(request.url).origin));
});
