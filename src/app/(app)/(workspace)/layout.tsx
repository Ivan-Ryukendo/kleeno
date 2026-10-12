import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/app-shell";
import { isOwner } from "@/core/tenancy";
import { AuthError, authenticate } from "@/server/auth/session";
import { getCompany } from "@/server/db/company";
import { shellData } from "@/server/db/shell";

// The signed-in frame: sidebar + top bar around every working page (docs/phases/P4u.md). It is a convenience, not the
// authorization check: every page and handler still authenticates on its own (rule 33). The shell queries are read-only,
// run through the session's own client and are scoped by its company and roles.
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const store = await cookies();
  let session: Awaited<ReturnType<typeof authenticate>>;
  try {
    session = await authenticate(store.getAll().map((c) => ({ name: c.name, value: c.value })));
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    if (e.code === "MFA_REQUIRED") {
      // A password-only user may still reach /account to set up the second step; no company data is loaded for them here.
      return (
        <div className="app-theme min-h-svh bg-background">
          <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">{children}</main>
        </div>
      );
    }
    redirect(e.code === "NO_COMPANY" ? "/select-company" : "/login");
  }
  const { actor, client, companies } = session;
  const [company, data] = await Promise.all([getCompany(actor.companyId), shellData(client, actor)]);

  return (
    <AppShell
      roles={[...actor.roles]}
      email={actor.email}
      companies={companies.map((c) => ({ id: c.companyId, name: c.name }))}
      activeId={actor.companyId}
      canCreate={isOwner(actor.roles)}
      live={company.liveEnabled}
      data={data}
      defaultOpen={store.get("sidebar_state")?.value !== "false"}
    >
      {children}
    </AppShell>
  );
}
