import "server-only";
import { z } from "zod";
import { auditEvent } from "@/core/audit";
import { INVALID_INVITE_MESSAGE, MIN_PASSWORD_LENGTH } from "@/core/invites";
import { writeAudit } from "@/server/db/audit";
import { db } from "@/server/db/client";
import { acceptInvite, peekInvite, userIdByEmail } from "@/server/db/invites";
import { companyCookie } from "./company";
import { assertNotThrottled, recordAuthEvent } from "./login";
import { AuthError, sessionClient, type CookieJar, type PendingCookie } from "./session";

export const invalidInvite = () => new AuthError(403, "FORBIDDEN", INVALID_INVITE_MESSAGE);

/**
 * Accepting an invite (S62). The account's email is always the invite's, never the request's. A new email gets an account created
 * on the server (public sign-up stays off); an existing account proves itself with its password. The membership appears in the
 * same transaction that burns the invite; the caller ends up signed in with the new company active.
 */
export async function acceptInviteWithPassword(input: { token: string; password: string; jar: CookieJar; cookies: PendingCookie[]; correlationId: string }) {
  const invite = await peekInvite(input.token);
  if (!invite) throw invalidInvite();
  const client = sessionClient(input.jar, input.cookies);
  const existingId = await userIdByEmail(invite.email);
  let userId: string;
  let created = false;
  if (existingId) {
    await assertNotThrottled(invite.companyId, existingId, "LOGIN_FAILED");
    const { data, error } = await client.auth.signInWithPassword({ email: invite.email, password: input.password });
    if (error || data.user?.id !== existingId) {
      await recordAuthEvent("LOGIN_FAILED", invite.companyId, existingId, input.correlationId);
      throw new AuthError(401, "UNAUTHENTICATED", "Invalid email or password");
    }
    userId = existingId;
  } else {
    if (input.password.length < MIN_PASSWORD_LENGTH) throw new z.ZodError([{ code: "custom", path: ["password"], message: "too short", input: undefined }]);
    const made = await db().auth.admin.createUser({ email: invite.email, password: input.password, email_confirm: true });
    if (made.error || !made.data.user) throw new AuthError(403, "FORBIDDEN", "That password was not accepted. Choose a longer, less common one.");
    userId = made.data.user.id;
    created = true;
  }
  const companyId = await acceptInvite(input.token, userId, invite.email);
  if (!companyId) {
    if (created) await db().auth.admin.deleteUser(userId); // lost a race with another use of the same link: leave no orphan account
    input.cookies.length = 0;
    throw invalidInvite();
  }
  if (created) {
    const { error } = await client.auth.signInWithPassword({ email: invite.email, password: input.password });
    if (error) throw new AuthError(403, "FORBIDDEN", "Your account was created. Sign in to continue.");
  }
  input.cookies.push(companyCookie(companyId));
  await writeAudit(auditEvent({ companyId, event: "invite.accept", entityType: "invite", entityId: invite.inviteId, actor: userId, actorType: "user", correlationId: input.correlationId, refs: { newAccount: created } }));
  return { companyId, newAccount: created, roles: invite.roles };
}
