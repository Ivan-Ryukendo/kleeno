import { SurveyBody } from "@/core/growth";
import { openRoute } from "@/server/auth/guard";
import { AuthError } from "@/server/auth/session";
import { allow, clientKey, completeSurvey } from "@/server/db/growth";

// Survey after sign-up (S54). A bad, used or expired token gets the same reply and changes nothing.
export const POST = openRoute({ scope: "waitlist", body: SurveyBody }, async ({ body, request }) => {
  if (!(await allow("survey", clientKey(request), 600, 20))) throw new AuthError(429, "THROTTLED", "Too many requests. Please try again later.");
  await completeSurvey(body);
  return { ok: true };
});
