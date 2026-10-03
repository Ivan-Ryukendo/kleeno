import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in · Kleeno" };

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-center text-2xl font-medium tracking-tight">Sign in to Kleeno</h1>
      <p className="mt-2 text-center text-muted-foreground">Payroll is confidential. Sign in to see your company&apos;s runs.</p>
      <div className="panel mt-6">
        {/* P4g: the "Continue with Google" button and its divider go here, above the email form. */}
        <div id="sso-slot" />
        <LoginForm />
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground">Join by invitation: request access on the home page. Arc testnet · no real funds.</p>
    </div>
  );
}
