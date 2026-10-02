import Link from "next/link";
import { CompanySwitcher, type NavCompany } from "./company-switcher";
import { SignOutButton } from "./sign-out-button";

export interface NavProps {
  signedIn?: boolean;
  companies?: NavCompany[];
  activeId?: string;
  canCreate?: boolean;
}

const link = "text-base font-medium";

// Floating white pill nav (DESIGN.md): company switcher, at most six top-level links, the rest under "More" (docs/pages.md).
export function AppNav({ signedIn = true, companies = [], activeId, canCreate = false }: NavProps) {
  return (
    <nav className="mx-auto mt-6 flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-x-8 gap-y-2 rounded-full bg-white px-8 py-3 shadow-nav">
      {signedIn && activeId ? (
        <CompanySwitcher companies={companies} activeId={activeId} canCreate={canCreate} />
      ) : (
        <Link href="/" className="text-lg font-medium tracking-tight">
          Kleeno
        </Link>
      )}
      {signedIn && (
        <>
          <Link href="/dashboard" className={link}>
            Dashboard
          </Link>
          <Link href="/workers" className={link}>
            Workers
          </Link>
          <Link href="/exceptions" className={link}>
            Exceptions
          </Link>
          <Link href="/configuration" className={link}>
            Configuration
          </Link>
          <Link href="/import" className={link}>
            Import
          </Link>
          <details className="group relative">
            <summary className={`${link} flex cursor-pointer list-none items-center gap-1 marker:hidden [&::-webkit-details-marker]:hidden`}>
              More <span aria-hidden className="text-xs transition-transform duration-150 group-open:rotate-180">▾</span>
            </summary>
            <div className="absolute right-0 z-20 mt-3 w-48 rounded-[1.5rem] bg-white p-2 shadow-card">
              {[
                ["/settings/team", "Team"],
                ["/settings/company", "Company"],
                ["/account", "Account"],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="block rounded-full px-4 py-2 text-sm hover:bg-muted">
                  {label}
                </Link>
              ))}
            </div>
          </details>
          <SignOutButton />
        </>
      )}
    </nav>
  );
}
