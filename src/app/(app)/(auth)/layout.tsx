import Link from "next/link";

// Sign-in, invitation, onboarding and company choice: one centred column on white, no sidebar (DESIGN.md §11, mockups/login.html).
// Each page sets its own card width. The login card keeps room for the Google button.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-theme min-h-svh bg-background">
      <main className="mx-auto flex min-h-svh w-full flex-col px-3 py-6 min-[521px]:px-6 min-[521px]:py-14">
        <Link href="/" className="mx-auto mb-5 flex items-center gap-2 text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-chip bg-primary text-xs font-semibold text-primary-foreground">K</span>
          Kleeno
        </Link>
        {children}
      </main>
    </div>
  );
}
