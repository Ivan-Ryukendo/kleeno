import { AppNav } from "@/components/app-nav";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in · Kleeno" };

export default function LoginPage() {
  return (
    <>
      <AppNav signedIn={false} />
      <main className="mx-auto max-w-md px-6 py-20">
        <p className="text-sm font-bold uppercase tracking-[0.04em]">
          <span className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
          Sign in
        </p>
        <h1 className="mt-4 text-5xl">Welcome back</h1>
        <div className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
          <p className="text-muted-foreground">Payroll is confidential. Sign in to see your company&apos;s runs.</p>
          <LoginForm />
          <p className="mt-6 text-sm text-muted-foreground">Accounts are created by Kleeno. Arc testnet · no real funds.</p>
        </div>
      </main>
    </>
  );
}
