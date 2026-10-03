import Link from "next/link";

// Sign-in, invitation, onboarding and company choice: one centred column on white, no sidebar (DESIGN.md §11).
// Each page sets its own width. The login card keeps room for the P4g "Continue with Google" button.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-theme min-h-svh bg-background">
      <main className="mx-auto flex min-h-svh w-full flex-col px-4 py-10 sm:px-6 sm:py-16">
        <Link href="/" className="mx-auto mb-8 flex items-center gap-2 text-lg font-medium tracking-tight">
          <span aria-hidden className="inline-block size-3 rounded-full bg-primary" />
          Kleeno
        </Link>
        {children}
      </main>
    </div>
  );
}
