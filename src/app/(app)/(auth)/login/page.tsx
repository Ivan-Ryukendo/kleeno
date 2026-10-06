import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/server/auth/oauth";

export const metadata = { title: "Sign in · Kleeno" };

// Set by the Google callback. Unknown values are ignored.
// Both read the same on purpose: an unknown Google email and a known account without a company must not look different.
const NO_GOOGLE_ACCESS = "We could not sign you in with Google. Try again, or use your email and password. If you are new, ask your company Owner for an invite or request access on the home page.";
const NOTICES: Record<string, string> = { oauth: NO_GOOGLE_ACCESS, "no-access": NO_GOOGLE_ACCESS };
const FACTOR_ID = /^[0-9a-f-]{36}$/i;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; step?: string; factor?: string; next?: string }> }) {
  const { error, step, factor, next } = await searchParams;
  const mfaFactorId = step === "mfa" && typeof factor === "string" && FACTOR_ID.test(factor) ? factor : undefined;
  const notice = typeof error === "string" && Object.hasOwn(NOTICES, error) ? NOTICES[error] : undefined;

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-center text-2xl font-medium tracking-tight">Sign in to Kleeno</h1>
      <p className="mt-2 text-center text-muted-foreground">Payroll is confidential. Sign in to see your company&apos;s runs.</p>
      <div className="panel mt-6">
        <LoginForm notice={notice} mfaFactorId={mfaFactorId} after={safeNext(next)} />
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground">Join by invitation: request access on the home page. Arc testnet · no real funds.</p>
    </div>
  );
}
