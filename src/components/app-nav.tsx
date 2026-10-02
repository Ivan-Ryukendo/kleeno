import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

// Floating white pill nav (DESIGN.md). Links grow with the phases; at most six top-level links.
export function AppNav({ signedIn = true }: { signedIn?: boolean }) {
  return (
    <nav className="mx-auto mt-6 flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-x-10 gap-y-2 rounded-full bg-white px-10 py-4 shadow-nav">
      <Link href="/" className="text-lg font-medium tracking-tight">
        Kleeno
      </Link>
      {signedIn && (
        <>
          <Link href="/dashboard" className="text-base font-medium">
            Dashboard
          </Link>
          <Link href="/workers" className="text-base font-medium">
            Workers
          </Link>
          <Link href="/configuration" className="text-base font-medium">
            Configuration
          </Link>
          <Link href="/import" className="text-base font-medium">
            Import
          </Link>
          <Link href="/exceptions" className="text-base font-medium">
            Exceptions
          </Link>
          <Link href="/account" className="text-base font-medium">
            Account
          </Link>
          <SignOutButton />
        </>
      )}
    </nav>
  );
}
