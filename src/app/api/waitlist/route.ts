import { randomBytes } from "node:crypto";
import { JoinBody, MIN_FILL_MS, hasSurvey } from "@/core/growth";
import { openRoute } from "@/server/auth/guard";
import { AuthError } from "@/server/auth/session";
import { allow, clientKey, joinWaitlist } from "@/server/db/growth";

// Public sign-up (S53–S55). New emails, repeat emails and caught bots all get the same reply.
export const POST = openRoute({ scope: "waitlist", body: JoinBody }, async ({ body, request }) => {
  if (!(await allow("join", clientKey(request), 600, 10)) || !(await allow("join-all", "global", 3600, 300)))
    throw new AuthError(429, "THROTTLED", "Too many sign-ups right now. Please try again later.");
  if (body.website || body.elapsedMs < MIN_FILL_MS) return { ok: true, token: hasSurvey(body) ? null : randomBytes(32).toString("base64url") };
  return { ok: true, token: await joinWaitlist(body) };
});
