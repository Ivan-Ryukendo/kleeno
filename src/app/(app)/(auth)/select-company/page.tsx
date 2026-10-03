import { connection } from "next/server";
import { CompanyChooser } from "@/components/company-chooser";
import { ROLE_LABELS } from "@/core/tenancy";
import { pageUser } from "@/server/auth/page-session";

export const metadata = { title: "Choose a company · Kleeno" };

export default async function SelectCompanyPage() {
  await connection();
  const { companies } = await pageUser();
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-center text-2xl font-medium tracking-tight">Choose a company</h1>
      <p className="mt-2 text-center text-muted-foreground">Your login belongs to more than one company. Everything you see next belongs to the one you choose.</p>
      <CompanyChooser companies={companies.map((c) => ({ id: c.companyId, name: c.name, roles: c.roles.map((r) => ROLE_LABELS[r]).join(", ") }))} />
    </div>
  );
}
