"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/google-button";
import { Input, Label } from "@/components/ui/input";
import { PasswordField } from "@/components/password-field";
import { postJson } from "@/lib/api";

type Step = { kind: "password" } | { kind: "mfa"; factorId: string };

/** `mfaFactorId` and `after` come from the Google callback, which sends a user with an authenticator straight to the code step.
 * The card follows mockups/login.html. Forgot-password, trusted browsers and recovery codes have no backing flow, so they are not offered. */
export function LoginForm({ notice, mfaFactorId, after = "/dashboard" }: { notice?: string; mfaFactorId?: string; after?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(mfaFactorId ? { kind: "mfa", factorId: mfaFactorId } : { kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    if (step.kind === "password") {
      const r = await postJson<{ next: string; factorId?: string }>("/api/auth/login", { email: f.get("email"), password: f.get("password") });
      if (!r.ok) setError(r.error ?? "Sign-in failed");
      else if (r.data?.next === "mfa" && r.data.factorId) setStep({ kind: "mfa", factorId: r.data.factorId });
      else {
        router.push(r.data?.next === "enrol" ? "/account" : "/dashboard");
        router.refresh();
      }
    } else {
      const r = await postJson("/api/auth/mfa/verify", { factorId: step.factorId, code: f.get("code") });
      if (!r.ok) setError(r.error ?? "That code is not valid");
      else {
        router.push(after);
        router.refresh();
      }
    }
    setBusy(false);
  }

  const mfa = step.kind === "mfa";
  return (
    <section aria-labelledby="signin-title" className="rounded-card border border-border bg-card p-7 max-[520px]:p-5">
      {mfa && <p className="mb-3.5 text-center text-xs font-medium text-muted-foreground">Step 2 of 2</p>}
      <h1 id="signin-title" className="text-center text-xl font-medium tracking-tight">{mfa ? "Enter your 6-digit code" : "Sign in to Kleeno"}</h1>
      <p className="mt-1.5 mb-5 text-center text-muted-foreground">{mfa ? "Open your authenticator app for Kleeno. Codes change every 30 seconds." : "Use the email your company invited."}</p>
      {notice && (
        <p role="alert" className="mb-4 text-sm font-medium text-signal">
          {notice}
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3.5" aria-busy={busy}>
        {!mfa ? (
          <>
            <div>
              <Label htmlFor="email" className="text-[13px]">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} placeholder="name@company.com" required className="h-9.5 max-[520px]:text-base" />
            </div>
            <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />
          </>
        ) : (
          <div>
            <Label htmlFor="code" className="text-[13px]">Code from your authenticator app</Label>
            <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" aria-describedby="code-help" required autoFocus className="h-12 pl-[0.4em] text-center text-[22px] tracking-[0.4em] tabular-nums max-[520px]:text-[22px]" />
            <small id="code-help" className="mt-1.5 block text-xs text-muted-foreground">Pasting the code works.</small>
          </div>
        )}
        {error && (
          <p id="login-error" role="alert" className="text-sm font-medium text-signal">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} aria-describedby={error ? "login-error" : undefined} className="h-9.5 min-h-11 w-full rounded-field px-4 text-sm">
          {busy ? (mfa ? "Verifying…" : "Signing in…") : (mfa ? "Verify and continue" : "Sign in")}
        </Button>
        {mfa && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setStep({ kind: "password" }); setError(null); }} className="min-h-11 w-full rounded-field px-4 text-sm">
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Use a different account
          </Button>
        )}
      </form>
      {!mfa && (
        <>
          <div className="my-4 flex items-center gap-2.5 text-xs text-muted-foreground" role="separator" aria-label="or">
            <span className="h-px flex-1 bg-border" />
            <span aria-hidden="true">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleButton disabled={busy} />
          <p className="mt-2 text-center text-xs text-muted-foreground">Google works for existing accounts only.</p>
          <p className="mt-4 text-center text-[13px] text-muted-foreground">
            New to Kleeno? Join by invite:{" "}
            <Link href="/#join" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">request access on the home page</Link>.
          </p>
        </>
      )}
    </section>
  );
}
