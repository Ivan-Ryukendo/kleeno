import { Analytics } from "@vercel/analytics/next";
import Link from "next/link";

// Public pages (landing, privacy). Vercel Web Analytics is cookieless and runs only here, never on signed-in or admin pages.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-5 focus:py-3 focus:shadow-nav">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 px-4 pt-4 sm:pt-6">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-full bg-white/90 py-2.5 pl-6 pr-2.5 shadow-nav backdrop-blur sm:pl-8">
          <Link href="/" className="flex items-center gap-2 text-xl font-medium tracking-tight">
            <span aria-hidden className="inline-block size-3 rounded-full bg-primary" />
            Kleeno
          </Link>
          <div className="hidden items-center gap-8 text-base font-medium md:flex">
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#who-its-for">Who it&apos;s for</Link>
            <Link href="/#faq">FAQ</Link>
          </div>
          <Link href="/#join" className="inline-flex h-11 items-center rounded-[1.25rem] bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            Join the waitlist
          </Link>
        </nav>
      </header>
      {children}
      <footer className="mt-24 bg-ink px-6 pb-20 pt-16 text-white sm:px-12">
        <div className="mx-auto max-w-6xl">
          <p className="max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">Payroll you can explain, line by line.</p>
          <div className="mt-12 flex flex-col gap-6 border-t border-white/20 pt-8 text-sm text-white/80 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 Kleeno. In development, not yet available.</p>
            <ul className="flex flex-wrap gap-6">
              <li>
                <Link href="/#join" className="hover:text-white">Join the waitlist</Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-white">Privacy</Link>
              </li>
              <li>
                <Link href="/#faq" className="hover:text-white">FAQ</Link>
              </li>
            </ul>
          </div>
        </div>
      </footer>
      <Analytics />
    </>
  );
}
