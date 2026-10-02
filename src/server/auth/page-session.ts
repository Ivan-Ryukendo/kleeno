import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isOwner } from "@/core/tenancy";
import { AuthError, authenticate, authenticateUser, type Actor, type Membership } from "./session";

const jarOf = async () => (await cookies()).getAll().map((c) => ({ name: c.name, value: c.value }));

/** Session for server-rendered pages. Signed-out or half-signed-in users are sent to /login, users who have not chosen a company to /select-company; every data page calls this itself (rule 33). */
export async function pageSession(opts: { allowAal1?: boolean } = {}) {
  try {
    return await authenticate(await jarOf(), opts);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    redirect(e.code === "MFA_REQUIRED" ? (e.enrol ? "/account" : "/login?step=mfa") : e.code === "NO_COMPANY" ? "/select-company" : "/login");
  }
}

/** Session for the company chooser: signed in, company not chosen yet. */
export async function pageUser() {
  try {
    const u = await authenticateUser(await jarOf());
    if (u.nextLevel === "aal2" && u.aal !== "aal2") redirect("/login?step=mfa");
    return u;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    redirect("/login");
  }
}

/** Props for the nav pill: the company switcher list and whether this member may create a company. */
export const navFor = (s: { actor: Actor; companies: Membership[] }) => ({
  companies: s.companies.map((c) => ({ id: c.companyId, name: c.name })),
  activeId: s.actor.companyId,
  canCreate: isOwner(s.actor.roles),
});
