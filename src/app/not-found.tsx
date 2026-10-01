import Link from "next/link";

// One 404 for everything: unknown URLs, locked payroll pages and the internal admin routes look exactly the same.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center px-6">
      <p className="text-sm font-bold uppercase tracking-[0.04em]">
        <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
        404
      </p>
      <h1 className="mt-4 text-5xl font-medium tracking-[-0.02em]">This page doesn&apos;t exist.</h1>
      <p className="mt-4 text-lg text-muted-foreground">Kleeno is in development. The waitlist is the place to start.</p>
      <Link href="/" className="mt-8 inline-flex h-12 items-center rounded-[1.25rem] bg-primary px-7 text-base font-medium text-primary-foreground hover:bg-primary/85">
        Go to the home page
      </Link>
    </main>
  );
}
