import { connection } from "next/server";
import { AppNav } from "@/components/app-nav";
import { CompanyChooser } from "@/components/company-chooser";
import { ROLE_LABELS } from "@/core/tenancy";
import { pageUser } from "@/server/auth/page-session";

export const metadata = { title: "Choose a company · Kleeno" };

export default async function SelectCompanyPage() {
  await connection();
  const { companies } = await pageUser();
  return (
    <>
      <AppNav signedIn={false} />
      <main className="mx-auto max-w-xl px-6 py-20">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Workspace
        </p>
        <h1 className="mt-4 text-5xl">Choose a company</h1>
        <p className="mt-4 text-muted-foreground">Your login belongs to more than one company. Everything you see next belongs to the one you choose.</p>
        <CompanyChooser companies={companies.map((c) => ({ id: c.companyId, name: c.name, roles: c.roles.map((r) => ROLE_LABELS[r]).join(", ") }))} />
      </main>
    </>
  );
}
