import { connection } from "next/server";
import { AdminLoginForm } from "@/components/admin-forms";
import { adminBase } from "@/server/auth/admin";

export default async function AdminLoginPage() {
  await connection();
  const base = await adminBase();
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <p className="text-sm font-bold uppercase tracking-[0.04em]">
        <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
        Team only
      </p>
      <h1 className="mt-4 text-5xl font-medium tracking-[-0.02em]">Lead list</h1>
      <div className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
        <p className="text-muted-foreground">Sign in with your admin account and authenticator code.</p>
        <AdminLoginForm base={base} />
      </div>
    </main>
  );
}
