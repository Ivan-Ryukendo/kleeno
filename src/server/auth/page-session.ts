import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, authenticate } from "./session";

/** Session for server-rendered pages. Signed-out or half-signed-in users are sent to /login; every data page calls this itself (rule 33). */
export async function pageSession(opts: { allowAal1?: boolean } = {}) {
  const jar = (await cookies()).getAll().map((c) => ({ name: c.name, value: c.value }));
  try {
    return await authenticate(jar, opts);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    redirect(e.code === "MFA_REQUIRED" ? "/login?step=mfa" : "/login");
  }
}
