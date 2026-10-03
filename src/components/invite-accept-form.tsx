"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

/** Accepting an invite: a new person chooses a password, an existing account enters its own. The email is fixed by the invite. */
export function InviteAcceptForm({ token, email, existingAccount }: { token: string; email: string; existingAccount: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await postJson<{ next: string }>("/api/invites/accept", { token, password: f.get("password") });
        if (!r.ok) {
          setError(r.error ?? "Could not accept the invitation");
          setBusy(false);
          return;
        }
        router.push(r.data?.next ?? "/dashboard");
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly autoComplete="username" />
      </div>
      <div>
        <Label htmlFor="password">{existingAccount ? "Your Kleeno password" : "Choose a password (12 characters or more)"}</Label>
        <Input id="password" name="password" type="password" minLength={existingAccount ? 1 : 12} maxLength={200} autoComplete={existingAccount ? "current-password" : "new-password"} required />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-signal">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-9 w-full rounded-field px-4 text-sm">
        {existingAccount ? "Sign in and join" : "Create account and join"}
      </Button>
    </form>
  );
}
