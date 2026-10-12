"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

export interface AccountCompany {
  id: string;
  name: string;
  roles: string[];
  current: boolean;
}

export function AccountCompanies({ companies, enabled }: { companies: AccountCompany[]; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(id: string) {
    setBusy(id);
    setError(null);
    const result = await postJson("/api/companies/switch", { target: id });
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "Could not switch company");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <ul className="mt-4 divide-y divide-border">
        {companies.map((company) => (
          <li key={company.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{company.name}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {company.roles.map((role) => <StatusPill key={role} status={role} />)}
              </p>
            </div>
            {company.current
              ? <StatusPill status="Current" />
              : <Button type="button" variant="outline" size="sm" disabled={!enabled || busy !== null} onClick={() => void switchTo(company.id)}>{busy === company.id ? "Switching…" : "Switch"}</Button>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-signal">{error}</p>}
      {!enabled && <p className="mt-3 text-sm text-muted-foreground">Complete multi-factor sign-in before switching companies.</p>}
    </>
  );
}

export function SignOutOthersButton({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function signOutOthers() {
    setBusy(true);
    setMessage(null);
    const result = await postJson("/api/auth/logout-others", {});
    setBusy(false);
    setMessage(result.ok
      ? { ok: true, text: "Other devices will need to sign in again when their current access expires. This device stays signed in." }
      : { ok: false, text: result.error ?? "Could not sign out other sessions" });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 max-w-xl text-sm text-muted-foreground">Individual sessions are not listed. Other devices may keep access until their current token expires; this device stays signed in.</p>
      <Button type="button" variant="outline" disabled={!enabled || busy} onClick={() => void signOutOthers()}>
        {busy ? "Signing out…" : "Sign out everywhere else"}
      </Button>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "basis-full text-sm" : "basis-full text-sm font-medium text-signal"}>{message.text}</p>}
      {!enabled && <p className="basis-full text-sm text-muted-foreground">Complete multi-factor sign-in before changing account security settings.</p>}
    </div>
  );
}

export function GoogleUnlinkForm({ enabled, hasPasswordMethod }: { enabled: boolean; hasPasswordMethod: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!hasPasswordMethod) {
    return <p className="mt-3 text-sm text-muted-foreground">Google is the only sign-in method and cannot be removed.</p>;
  }
  if (!enabled) {
    return <p className="mt-3 text-sm text-muted-foreground">Complete multi-factor sign-in before changing account security settings.</p>;
  }

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(true);
        setMessage(null);
        const result = await postJson("/api/auth/oauth/google/unlink", { password: new FormData(form).get("password") });
        setBusy(false);
        if (!result.ok) {
          setMessage({ ok: false, text: result.error ?? "Could not unlink Google" });
          return;
        }
        form.reset();
        setMessage({ ok: true, text: "Google sign-in was unlinked." });
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="google-unlink-password">Confirm your password</Label>
        <Input id="google-unlink-password" name="password" type="password" autoComplete="current-password" maxLength={200} required />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>{busy ? "Unlinking…" : "Unlink Google"}</Button>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm sm:col-span-2" : "text-sm font-medium text-signal sm:col-span-2"}>{message.text}</p>}
    </form>
  );
}
