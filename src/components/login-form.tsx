"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

type Step = { kind: "password" } | { kind: "mfa"; factorId: string };

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
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
        router.push("/dashboard");
        router.refresh();
      }
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {step.kind === "password" ? (
        <>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </>
      ) : (
        <div>
          <Label htmlFor="code">Code from your authenticator app</Label>
          <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-signal">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-9 w-full rounded-field px-4 text-sm">
        {step.kind === "password" ? "Sign in" : "Verify"}
      </Button>
    </form>
  );
}
