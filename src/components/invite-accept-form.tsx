"use client";

import { Check, Circle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PasswordField } from "@/components/password-field";
import { MIN_PASSWORD_LENGTH } from "@/core/invites";
import { postJson } from "@/lib/api";

const Req = ({ met, children }: { met: boolean; children: string }) => (
  <li className={`flex items-center gap-1.5 ${met ? "text-success" : "text-muted-foreground"}`}>
    {met ? <Check aria-hidden="true" className="size-3.5" /> : <Circle aria-hidden="true" className="size-3.5" />}
    {children}
    <span className="sr-only"> ({met ? "met" : "not yet"})</span>
  </li>
);

/** Accepting an invite: a new person chooses a password, an existing account enters its own. The email is fixed by the invite.
 * The checks beside the new password are advice only; the server enforces the length. */
export function InviteAcceptForm({ token, email, existingAccount }: { token: string; email: string; existingAccount: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const long = password.length >= MIN_PASSWORD_LENGTH;
  const notEmail = password.length > 0 && password.toLowerCase() !== email.toLowerCase() && !password.toLowerCase().includes(email.split("@")[0]!.toLowerCase());
  const same = confirm.length > 0 && confirm === password;
  const ready = existingAccount ? password.length > 0 : long && notEmail && same;
  return (
    <form
      className="mt-4 grid gap-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        const r = await postJson<{ next: string }>("/api/invites/accept", { token, password });
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
        <Label htmlFor="email" className="text-[13px]">Email</Label>
        <Input id="email" value={email} readOnly autoComplete="username" aria-describedby="email-help" className="h-9.5 bg-secondary max-[520px]:text-base" />
        <small id="email-help" className="mt-1.5 block text-xs text-muted-foreground">The invite is tied to this address.</small>
      </div>
      {existingAccount ? (
        <PasswordField id="password" name="password" label="Your Kleeno password" autoComplete="current-password" value={password} onChange={setPassword} />
      ) : (
        <>
          <div>
            <PasswordField id="password" name="password" label={`Choose a password (${MIN_PASSWORD_LENGTH} characters or more)`} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={200} describedBy="pw-reqs" value={password} onChange={setPassword} />
            <ul id="pw-reqs" aria-label="Password requirements" className="m-0 mt-2 grid list-none gap-1 p-0 text-xs">
              <Req met={long}>{`At least ${MIN_PASSWORD_LENGTH} characters`}</Req>
              <Req met={notEmail}>Different from your email</Req>
            </ul>
            <small className="mt-1.5 block text-xs text-muted-foreground">A password manager or a long passphrase works best.</small>
          </div>
          <PasswordField id="confirm-password" name="confirm-password" label="Confirm password" autoComplete="new-password" maxLength={200} describedBy="confirm-state" value={confirm} onChange={setConfirm} />
          <p id="confirm-state" role="status" className={`-mt-2 text-xs ${same ? "text-success" : "text-muted-foreground"}`}>{confirm.length === 0 ? "" : same ? "Passwords match." : "Passwords do not match yet."}</p>
        </>
      )}
      <p className="m-0 text-xs text-muted-foreground">Payroll data is confidential: Kleeno never sees worker names. If your company requires two-step verification, you will set it up next.</p>
      {error && (
        <p role="alert" className="text-sm font-medium text-signal">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !ready} className="h-9.5 min-h-11 w-full rounded-field px-4 text-sm">
        {existingAccount ? "Sign in and join" : "Accept invite"}
      </Button>
    </form>
  );
}
