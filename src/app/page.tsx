import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-6xl">Kleeno</h1>
      <Link href="/dashboard" className="rounded-[1.25rem] bg-primary px-6 py-2 font-medium text-primary-foreground">
        Dashboard
      </Link>
    </main>
  );
}
