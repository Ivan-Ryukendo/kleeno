import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@/server/db/growth";
import { adminGateOk, adminPath } from "@/server/site";
import { amrMethods } from "./oauth";
import { AuthError, sessionClient, type CookieJar, type PendingCookie } from "./session";

export interface AdminActor {
  userId: string;
}

/**
 * Platform admin (S52): a Supabase session + a row in growth.platform_admins + MFA (aal2), always. The session must also have been
 * opened with the password (`amr` claim): a Google session never reaches the admin area, even for a platform admin (P4g, S74).
 * Company roles (app_users) grant nothing here. `allowAal1` is only for the MFA enrol/verify steps.
 */
export async function authenticateAdmin(jar: CookieJar, opts: { allowAal1?: boolean; sink?: PendingCookie[] } = {}) {
  const client = sessionClient(jar, opts.sink);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "UNAUTHENTICATED", "sign in required");
  if (!(await isPlatformAdmin(data.user.id))) throw new AuthError(403, "FORBIDDEN", "not an admin");
  const { data: level } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!amrMethods(level?.currentAuthenticationMethods).includes("password")) throw new AuthError(403, "FORBIDDEN", "not an admin");
  if (level?.currentLevel !== "aal2" && !opts.allowAal1) throw new AuthError(401, "MFA_REQUIRED", "multi-factor sign-in required");
  return { admin: { userId: data.user.id } as AdminActor, client };
}

/** For admin pages: no gate header -> 404; signed out or no MFA -> the admin login; signed in but not an admin -> 404. */
export async function adminPageSession() {
  const base = await adminBase();
  const jar = (await cookies()).getAll().map((c) => ({ name: c.name, value: c.value }));
  try {
    return { ...(await authenticateAdmin(jar)), base };
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    if (e.code === "FORBIDDEN") notFound();
    redirect(`${base}/login`);
  }
}

/** The public base path of the admin area ("/<ADMIN_PATH>"), or 404 when the request did not come through the proxy gate. */
export async function adminBase() {
  if (!adminGateOk(await headers())) notFound();
  return `/${adminPath()}`;
}
