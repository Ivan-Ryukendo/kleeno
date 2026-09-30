import Link from "next/link";

// Floating white pill nav (DESIGN.md). P1 has only the Dashboard; the other links arrive with their pages.
export function AppNav() {
  return (
    <nav className="mx-auto mt-6 flex w-fit items-center gap-12 rounded-full bg-white px-10 py-4 shadow-nav">
      <Link href="/" className="text-lg font-medium tracking-tight">
        Kleeno
      </Link>
      <Link href="/dashboard" className="text-base font-medium">
        Dashboard
      </Link>
    </nav>
  );
}
