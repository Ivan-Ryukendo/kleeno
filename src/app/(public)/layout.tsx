import { Analytics } from "@vercel/analytics/next";
import Link from "next/link";
import { siteMode } from "@/server/site";

const sections = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#proof", label: "Proof" },
  { href: "/#safety", label: "Safety" },
  { href: "/#faq", label: "FAQ" },
];

const navLink = "inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium transition-colors duration-150 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const cta = "inline-flex min-h-11 items-center rounded-[1.25rem] bg-primary px-5 text-base font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const footLink = "inline-flex min-h-11 items-center text-white/80 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50";

// Public pages (landing, privacy). Vercel Web Analytics is cookieless and runs only here, never on signed-in or admin pages.
// "Sign in" shows only when the app is open (SITE_MODE=app); in waitlist mode /login is a 404 (docs/phases/W.md).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const appOpen = siteMode() === "app";
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-5 focus:py-3 focus:shadow-nav">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-6">
        <nav aria-label="Main" className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 rounded-full border border-white/70 bg-white/70 py-2 pl-5 pr-2 shadow-nav backdrop-blur-xl backdrop-saturate-150 sm:pl-7">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-xl font-medium tracking-tight">
            <span aria-hidden className="inline-block size-3 rounded-full bg-primary" />
            Kleeno
          </Link>
          <ul className="hidden items-center gap-1 md:flex">
            {sections.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className={navLink}>{s.label}</Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            {appOpen && (
              <span className="hidden sm:block">
                <Link href="/login" className={navLink}>
                  Sign in
                </Link>
              </span>
            )}
            <Link href="/#join" className={cta}>
              <span className="sm:hidden">Join</span>
              <span className="hidden sm:inline">Join the waitlist</span>
            </Link>
            <details className="group md:hidden">
              <summary aria-label="Menu" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="flex w-5 flex-col gap-1.5">
                  <span className="h-0.5 w-full rounded-full bg-foreground transition-transform duration-200 group-open:translate-y-1 group-open:rotate-45" />
                  <span className="h-0.5 w-full rounded-full bg-foreground transition-transform duration-200 group-open:-translate-y-1 group-open:-rotate-45" />
                </span>
              </summary>
              <ul className="absolute inset-x-0 top-[calc(100%+0.5rem)] rounded-[2.5rem] bg-white p-3 shadow-card">
                {sections.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href} className={`${navLink} w-full text-lg`}>{s.label}</Link>
                  </li>
                ))}
                {appOpen && (
                  <li>
                    <Link href="/login" className={`${navLink} w-full text-lg`}>Sign in</Link>
                  </li>
                )}
              </ul>
            </details>
          </div>
        </nav>
      </header>
      {children}
      <footer className="mt-8 bg-ink px-6 pb-24 pt-20 text-white sm:px-12 md:pb-36">
        <div className="mx-auto max-w-7xl">
          <p className="max-w-3xl text-[clamp(2rem,4vw,3.5rem)] font-medium leading-[1.05] tracking-[-0.02em]">Payroll you can explain, line by line.</p>
          <div className="mt-16 grid gap-10 sm:grid-cols-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.04em] text-white/60">Product</p>
              <ul className="mt-3">
                <li><Link href="/#how-it-works" className={footLink}>How it works</Link></li>
                <li><Link href="/#proof" className={footLink}>Proof</Link></li>
                <li><Link href="/#safety" className={footLink}>Safety</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.04em] text-white/60">Access</p>
              <ul className="mt-3">
                <li><Link href="/#join" className={footLink}>Join the waitlist</Link></li>
                {appOpen && <li><Link href="/login" className={footLink}>Sign in</Link></li>}
                <li><Link href="/#faq" className={footLink}>FAQ</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.04em] text-white/60">Trust</p>
              <ul className="mt-3">
                <li><Link href="/privacy" className={footLink}>Privacy</Link></li>
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-white/70">Payments run in simulation or on Arc testnet with test USDC. No real funds.</p>
            </div>
          </div>
          <div className="mt-16 flex flex-col gap-3 border-t border-white/20 pt-8 text-sm text-white/70 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 Kleeno. In development, not yet available.</p>
            <p>Built for the Tameion Agents Hackathon on Arc.</p>
          </div>
        </div>
      </footer>
      {process.env.NODE_ENV === "production" && <Analytics />}
    </>
  );
}
